'use strict';
// Rook rules and computer players. One engine instance runs each table.
const SUITS=['Y','B','R','G'];
const SN={Y:'Yellow',B:'Black',R:'Red',G:'Green',K:'Rook'};
const TARGET=400, MAXBID=145;
const NOISE={easy:15,medium:6,hard:2};
const HARD={voids:true,pvLead:true,overtake:true,bidUp:true};

function createEngine(opts){
  // opts.names() -> 4 display names, opts.isHuman(p) -> bool, opts.level() -> 'easy'|'medium'|'hard', opts.onEvent(ev)
  let G=null, SIM=false;
  let levelFor=()=>opts.level();
  const nm=p=>opts.names()[p]||('Seat '+(p+1));
  const team=t=>nm(t)+' & '+nm(t+2);
  function emit(ev){if(!SIM&&opts.onEvent)opts.onEvent(ev);}
  function log(t){if(SIM)return;G.log.unshift(t);if(G.log.length>80)G.log.pop();}
  function commit(){}
  /* ---------- card helpers ---------- */
  function mkDeck(){const d=[];for(const s of SUITS)for(let r=1;r<=14;r++)d.push({id:s+r,s,r});d.push({id:'ROOK',s:'K',r:15});return d;}
  function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  const pts=c=>c.s==='K'?20:(c.r===5?5:(c.r===10||c.r===14)?10:0);
  const isCounter=c=>pts(c)>0;
  const isTrump=c=>c.s==='K'||c.s===G.trump;
  const eff=c=>c.s==='K'?G.trump:c.s;
  function power(c,lead){if(isTrump(c))return 100+c.r;if(c.s===lead)return c.r;return 0;}
  function cost(c){if(c.s==='K')return 200;return (isTrump(c)?30+c.r:c.r)+pts(c)*3;}
  const minBy=(a,f)=>a.reduce((b,x)=>b===null||f(x)<f(b)?x:b,null);
  const maxBy=(a,f)=>a.reduce((b,x)=>b===null||f(x)>f(b)?x:b,null);
  const r5=x=>Math.floor(x/5)*5;
  const byId=id=>{if(id==='ROOK')return{id,s:'K',r:15};return{id,s:id[0],r:+id.slice(1)};};

  /* ---------- flow ---------- */
  function newGame(){
    G={scores:[0,0],dealer:Math.floor(Math.random()*4),handNo:0,log:[],winner:null,result:null};
    log('New game. First team to '+TARGET+' wins.');
    deal();
  }
  function deal(){
    const d=shuffle(mkDeck());
    G.handNo++;
    G.hands=[[],[],[],[]];
    for(let i=0;i<52;i++)G.hands[i%4].push(d[i]);
    G.kitty=d.slice(52);G.kittyIds=null;
    G.trump=null;G.bidWinner=null;G.contract=0;G.discards=[];G.result=null;
    G.bid={high:0,by:null,passed:[false,false,false,false],status:['','','','']};
    G.turn=(G.dealer+1)%4;
    G.trick=[];G.tricksWon=[0,0];G.ptsWon=[0,0];G.played=[];G.voids=[{},{},{},{}];G.lastTrick=null;G.trickWinner=null;
    G.est=[null,null,null,null];G.hardTrump=[null,null,null,null];
    G.phase='bid';
    log('Hand '+G.handNo+': '+nm(G.dealer)+' deals. '+nm(G.turn)+' bids first.');
    emit({t:'deal'});
  }
  function computeEst(p){
    const lv=levelFor(p);
    const clamp=x=>Math.max(20,Math.min(MAXBID,x));
    if(lv==='hard'){const r=rolloutEstimate(p);G.est[p]=clamp(r5(r.est));G.hardTrump[p]=r.trump;}
    else G.est[p]=clamp(r5(estimate(G.hands[p])+Math.round((Math.random()*2-1)*NOISE[lv])));
  }
  function nextActiveBidder(p){for(let i=1;i<=4;i++){const q=(p+i)%4;if(!G.bid.passed[q])return q;}return p;}
  function bidAction(p,amt){
    const b=G.bid;
    if(amt===null){b.passed[p]=true;b.status[p]='Pass';log(nm(p)+' passes.');}
    else{b.high=amt;b.by=p;b.status[p]='Bid '+amt;log(nm(p)+' bids '+amt+'.');}
    emit({t:'bid',p,amt});
    const pc=b.passed.filter(Boolean).length;
    if(pc===4){log('Everyone passed. Redealing.');G.dealer=(G.dealer+1)%4;G.phase='redeal';}
    else if(pc===3&&b.by!==null)winBid();
    else if(b.high>=MAXBID&&b.by!==null)winBid();
    else G.turn=nextActiveBidder(p);
  }
  function winBid(){
    const p=G.bid.by;G.bidWinner=p;G.contract=G.bid.high;G.turn=p;
    log(nm(p)+' wins the bid at '+G.contract+'.');
    G.phase='trump';
  }
  function nameTrump(p,suit){
    G.trump=suit;log(nm(p)+' names '+SN[suit]+' trump.');emit({t:'trump',p,suit});
    G.kittyIds=G.kitty.map(c=>c.id);G.hands[p].push(...G.kitty);
    log(nm(p)+' picks up the kitty.');
    G.phase='kitty';
  }
  function doDiscard(p,ds){
    G.discards=ds;G.hands[p]=G.hands[p].filter(c=>!ds.includes(c));
    emit({t:'discard',p});
    G.phase='play';G.turn=(G.dealer+1)%4;G.trick=[];
    log(nm(G.turn)+' leads the first trick.');
  }
  function aiFinishKitty(){
    const p=G.bidWinner;
    if(G.phase==='trump'){
      if(levelFor(p)==='hard'&&!G.hardTrump[p])computeEst(p);
      nameTrump(p,(levelFor(p)==='hard'&&G.hardTrump[p])?G.hardTrump[p]:bestSuit(G.hands[p]));
    }
    doDiscard(p,aiDiscards(p));
  }
  function legal(p){
    const h=G.hands[p];if(!G.trick.length)return h.slice();
    const lead=eff(G.trick[0].card);const f=h.filter(c=>eff(c)===lead);
    return f.length?f:h.slice();
  }
  function playCard(p,card){
    G.hands[p]=G.hands[p].filter(c=>c.id!==card.id);
    if(G.trick.length){
      const lead=eff(G.trick[0].card);
      if(eff(card)!==lead)G.voids[p][lead]=true;
      else if(isCounter(card)&&card.s!=='K'&&!G.voids[p][lead]){
        // A counter dropped on a trick the other side has won (partner already played) looks forced.
        const w=trickWinner();
        const partnerDone=G.trick.some(e=>e.p===(p+2)%4);
        if(w.p%2!==p%2&&power(card,lead)<power(w.card,lead)&&partnerDone)G.voids[p][lead]='likely';
      }
    }
    G.trick.push({p,card});G.played.push(card.id);
    emit({t:'play',p,id:card.id});
    if(G.trick.length===4){G.phase='trickEnd';G.trickWinner=trickWinner().p;}
    else G.turn=(p+1)%4;
  }
  function trickWinner(){const lead=eff(G.trick[0].card);return maxBy(G.trick,e=>power(e.card,lead));}
  function resolveTrick(){
    const w=trickWinner();const t=w.p%2;
    const cp=G.trick.reduce((a,e)=>a+pts(e.card),0);
    G.tricksWon[t]++;G.ptsWon[t]+=2+cp;
    G.lastTrick={cards:G.trick.slice(),winner:w.p};
    log(nm(w.p)+' takes the trick'+(cp?' with '+cp+' in counters':'')+'.');
    emit({t:'trick',p:w.p,pts:cp});
    G.trick=[];G.trickWinner=null;
    if(G.hands[0].length===0){if(SIM)G.phase='done';else endHand();}
    else{G.turn=w.p;G.phase='play';}
  }
  function endHand(){
    const bt=G.bidWinner%2, ot=1-bt;
    const made=G.ptsWon[bt]>=G.contract;
    const delta=[0,0];delta[bt]=made?G.ptsWon[bt]:-G.contract;delta[ot]=G.ptsWon[ot];
    const before=G.scores.slice();
    G.scores[0]+=delta[0];G.scores[1]+=delta[1];
    G.result={bt,made,delta,before,pts:G.ptsWon.slice(),tricks:G.tricksWon.slice(),contract:G.contract,bidder:G.bidWinner,trump:G.trump,discards:G.discards.map(c=>c.id)};
    log(made?team(bt)+' made '+G.contract+' with '+G.ptsWon[bt]+'.':team(bt)+' went set: '+G.ptsWon[bt]+' of '+G.contract+'.');
    const hi=Math.max(...G.scores);
    if(hi>=TARGET&&G.scores[0]!==G.scores[1]){G.winner=G.scores[0]>G.scores[1]?0:1;log(team(G.winner)+' win the game.');}
    G.phase='handEnd';
    emit({t:'hand',bt,made});
    if(G.winner!==null)emit({t:'game',winner:G.winner});
  }
  function nextHand(){G.dealer=(G.dealer+1)%4;deal();}

  /* ---------- computer players ---------- */
  /* ---------- AI ---------- */
  function suitScore(hand,s){const cs=hand.filter(c=>c.s===s);return cs.length*3+cs.reduce((a,c)=>a+Math.max(0,c.r-9),0);}
  function bestSuit(hand){return maxBy(SUITS,s=>suitScore(hand,s));}
  function estimate(hand){
  const t=bestSuit(hand);let e=30;
  e+=hand.filter(c=>c.s===t).length*5;
  for(const c of hand){
    if(c.s==='K'){e+=22;continue;}
    if(c.r===14)e+=6;else if(c.r===13)e+=4;else if(c.r===12)e+=2;
    if(c.s===t&&c.r>=11)e+=2;
  }
  return e+6;
  }
  function aiBid(p){
  if(G.est[p]==null)computeEst(p);
  const b=G.bid,est=G.est[p];
  if(b.high===0){return est>=55?Math.max(5,r5(Math.min(est-10,70))):null;}
  const need=b.high+5;
  const partnerHigh=b.by!==null&&b.by%2===p%2;
  const partnerBid=G.bid.status[(p+2)%4].startsWith('Bid');
  let limit=est;
  if(partnerHigh&&levelFor(p)!=='easy')limit-=15;
  if(levelFor(p)==='hard'&&HARD.bidUp&&partnerBid&&!partnerHigh)limit+=5;
  return need<=limit&&need<=MAXBID?need:null;
  }
  function aiDiscards(p){
  // Void as many side suits as possible first, then shorten the shortest suits, then drop low cards.
  const h=G.hands[p];const out=[];
  const side=SUITS.filter(s=>s!==G.trump);
  const cardsOf=s=>h.filter(c=>c.s===s);
  const voidable=side.filter(s=>cardsOf(s).length&&cardsOf(s).every(c=>!isCounter(c)))
    .sort((a,b)=>cardsOf(a).length-cardsOf(b).length||Math.max(...cardsOf(a).map(c=>c.r))-Math.max(...cardsOf(b).map(c=>c.r)));
  for(const s of voidable){const cs=cardsOf(s);if(out.length+cs.length<=5)out.push(...cs);}
  if(out.length<5){
    const left=s=>h.filter(c=>c.s===s&&!out.includes(c)).length;
    const rest=h.filter(c=>!out.includes(c)&&!isCounter(c)&&!isTrump(c))
      .sort((a,b)=>left(a.s)-left(b.s)||a.r-b.r);
    out.push(...rest.slice(0,5-out.length));
  }
  if(out.length<5){
    const tr=h.filter(c=>!out.includes(c)&&!isCounter(c)&&isTrump(c)).sort((a,b)=>a.r-b.r);
    out.push(...tr.slice(0,5-out.length));
  }
  return out;
  }
  function knownSet(p){
  const k=new Set(G.played);for(const c of G.hands[p])k.add(c.id);
  if(p===G.bidWinner)for(const c of G.discards)k.add(c.id);
  return k;
  }
  function isBoss(p,c,known){
  if(c.s==='K')return true;
  known=known||knownSet(p);
  const s=eff(c);
  for(let r=c.r+1;r<=14;r++)if(!known.has(s+r))return false;
  if(s===G.trump&&!known.has('ROOK'))return false;
  return true;
  }
  function trumpIds(){const a=['ROOK'];for(let r=1;r<=14;r++)a.push(G.trump+r);return a;}
  function aiChoose(p){
  const L=legal(p);if(L.length===1)return L[0];
  if(levelFor(p)==='easy')return aiEasy(p,L);
  if(levelFor(p)==='hard')return aiHard(p,L);
  return aiSmart(p,L,false);
  }
  function aiEasy(p,L){
  if(Math.random()<0.35)return L[Math.floor(Math.random()*L.length)];
  if(!G.trick.length)return maxBy(L,c=>isTrump(c)?c.r-20:c.r);
  const lead=eff(G.trick[0].card);const win=trickWinner();const wp=power(win.card,lead);
  if(win.p%2===p%2)return minBy(L,cost);
  const w=L.filter(c=>power(c,lead)>wp);
  if(w.length)return maxBy(w,c=>power(c,lead));
  return minBy(L,cost);
  }
  function aiSmart(p,L,hard){
  const V=hard&&HARD.voids?G.voids:[{},{},{},{}];
  const known=knownSet(p);
  const opps=[(p+1)%4,(p+3)%4];
  const outTr=trumpIds().filter(id=>!known.has(id)).length;
  if(!G.trick.length){
    const tr=L.filter(isTrump);const bt=G.bidWinner%2;
    const oppsVoid=opps.every(o=>V[o][G.trump]);
    if(p%2===bt&&tr.length&&outTr>0&&!oppsVoid){
      const boss=tr.filter(c=>isBoss(p,c,known));
      if(boss.length)return minBy(boss,c=>c.s==='K'?99:c.r);
      if(tr.length>=4){const low=tr.filter(c=>!isCounter(c));if(low.length)return minBy(low,c=>c.r);}
    }
    const nt=L.filter(c=>!isTrump(c));
    const safe=nt.filter(c=>isBoss(p,c,known)&&!(outTr>0&&opps.some(o=>V[o][c.s])));
    if(safe.length)return maxBy(safe,c=>pts(c)*10+c.r);
    const low=nt.filter(c=>!isCounter(c));
    if(hard&&HARD.pvLead){const pv=low.filter(c=>V[(p+2)%4][c.s]&&!V[(p+2)%4][G.trump]);if(pv.length)return minBy(pv,c=>c.r);}
    if(low.length)return minBy(low,c=>c.r);
    return minBy(L,cost);
  }
  const lead=eff(G.trick[0].card);
  const win=trickWinner();const wp=power(win.card,lead);
  const tp=G.trick.reduce((a,e)=>a+pts(e.card),0);
  const last=G.trick.length===3;
  const after=[];for(let i=G.trick.length+1;i<4;i++)after.push((G.trick[0].p+i)%4);
  const oppsAfter=after.filter(o=>o%2!==p%2);
  const holds=c=>{
    if(!oppsAfter.length)return true;
    if(!isBoss(p,c,known))return false;
    if(isTrump(c))return true;
    return outTr===0||!oppsAfter.some(o=>V[o][lead]);
  };
  if(win.p%2===p%2){
    // Partner is winning. Cards that would play over the partner are kept when possible.
    const under=L.filter(c=>power(c,lead)<=wp);
    if(holds(win.card)){
      // Nothing left out there can beat the partner (the only higher cards are ours, played, or discarded):
      // keep our high cards and add points underneath.
      if(under.length){
        const cs=under.filter(c=>isCounter(c)&&c.s!=='K'&&(!isTrump(c)||lead===G.trump));
        if(cs.length)return maxBy(cs,c=>pts(c)*10-c.r);
        return minBy(under,cost);
      }
      return minBy(L,c=>power(c,lead));
    }
    if(hard&&HARD.overtake&&tp>=10){const sw=L.filter(c=>power(c,lead)>wp&&holds(c)&&c.s!=='K');if(sw.length)return minBy(sw,cost);}
    return minBy(under.length?under:L,cost);
  }
  const winners=L.filter(c=>power(c,lead)>wp);
  if(winners.length){
    const ruffing=lead!==G.trump&&winners.every(isTrump);
    if(ruffing){
      // Out of the led suit: trump in low and save the high trumps for pulling trump later,
      // unless an opponent still to play is known to be out of this suit too (could over-trump).
      const overRuff=oppsAfter.some(o=>V[o][lead]&&V[o][G.trump]!==true);
      const worth=last||tp>0||L.filter(isTrump).length>=3;
      if(worth&&!overRuff){
        const plain=winners.filter(c=>c.s!=='K'&&!isCounter(c));
        return minBy(plain.length?plain:winners,c=>power(c,lead)+pts(c));
      }
      if(worth&&tp>=10){const sw=winners.filter(holds);if(sw.length)return minBy(sw,cost);}
    }
    else if(last){const w=minBy(winners,cost);if(tp>0||cost(w)<40)return w;}
    else{
      const sw=winners.filter(holds);if(sw.length)return minBy(sw,cost);
      if(tp>=10&&!oppsAfter.some(o=>V[o][lead])){const nr=winners.filter(c=>c.s!=='K');if(nr.length)return minBy(nr,cost);}
    }
  }
  // Losing the trick: give up the lowest card, keeping counters and trumps.
  return minBy(L,cost);
  }

  /* ---------- hard AI: look-ahead by playing out sampled deals ---------- */
  function withSim(state,fn){
  const sg=G,sl=levelFor,ss=SIM;G=state;levelFor=()=>'medium';SIM=true;
  try{return fn();}finally{G=sg;levelFor=sl;SIM=ss;}
  }
  function pickWeighted(opts){let tot=0;for(const o of opts)tot+=o.w;let x=Math.random()*tot;for(const o of opts){x-=o.w;if(x<=0)return o.k;}return opts[opts.length-1].k;}
  // Deal the cards p can't see to the other seats (and the unseen discards), respecting known voids.
  function sampleWorld(p){
  const known=new Set(G.played);for(const c of G.hands[p])known.add(c.id);
  const bidder=p===G.bidWinner;if(bidder)for(const c of G.discards)known.add(c.id);
  const pool=mkDeck().filter(c=>!known.has(c.id));
  const seats=[0,1,2,3].filter(q=>q!==p);
  const need={};for(const q of seats)need[q]=G.hands[q].length;
  const dNeed=bidder?0:5;
  for(let attempt=0;attempt<40;attempt++){
    const useVoids=attempt<30;
    shuffle(pool);const H={};for(const q of seats)H[q]=[];const D=[];let ok=true;
    for(const c of pool){
      const opts=[];
      for(const q of seats){
        const room=need[q]-H[q].length;if(room<=0)continue;
        const v=useVoids?G.voids[q][eff(c)]:false;
        if(v===true||(v==='likely'&&!isCounter(c)))continue;
        opts.push({k:q,w:room});
      }
      if(D.length<dNeed&&!isCounter(c))opts.push({k:'d',w:dNeed-D.length});
      if(!opts.length){ok=false;break;}
      const k=pickWeighted(opts);if(k==='d')D.push(c);else H[k].push(c);
    }
    if(!ok)continue;
    const hands=[0,1,2,3].map(q=>q===p?G.hands[p].slice():H[q]);
    return {hands,discards:bidder?G.discards.slice():D};
  }
  return null;
  }
  function worldState(w){
  return {scores:G.scores.slice(),dealer:G.dealer,handNo:G.handNo,log:[],winner:null,
    hands:w.hands,kitty:[],trump:G.trump,bidWinner:G.bidWinner,contract:G.contract,discards:w.discards,
    bid:G.bid,turn:G.turn,trick:G.trick.slice(),tricksWon:G.tricksWon.slice(),ptsWon:G.ptsWon.slice(),
    played:G.played.slice(),voids:G.voids.map(v=>Object.assign({},v)),lastTrick:null,trickWinner:null,est:G.est,phase:'play'};
  }
  function handUtility(team){
  const bt=G.bidWinner%2,ot=1-bt,pw=G.ptsWon;
  const d=[0,0];d[bt]=pw[bt]>=G.contract?pw[bt]:-G.contract;d[ot]=pw[ot];
  return d[team]-d[1-team];
  }
  function playOut(){
  let guard=0;
  while(G.phase!=='done'&&guard++<80){
    if(G.phase==='trickEnd')resolveTrick();
    else playCard(G.turn,aiChoose(G.turn));
  }
  }
  function aiHard(p,L){
  const base=aiSmart(p,L,true);
  const N=18,worlds=[];
  for(let i=0;i<N;i++){const w=sampleWorld(p);if(w)worlds.push(w);}
  if(!worlds.length)return base;
  let best=base,bestV=-Infinity;
  for(const c of L){
    let v=0;
    for(const w of worlds){
      const st=worldState({hands:w.hands.map(h=>h.slice()),discards:w.discards});
      v+=withSim(st,()=>{playCard(p,G.hands[p].find(x=>x.id===c.id));playOut();return handUtility(p%2);});
    }
    v=v/worlds.length+(c.id===base.id?0.5:0);
    if(v>bestV){bestV=v;best=c;}
  }
  return best;
  }
  // Estimate what p's team takes as bidder by playing out random deals, for the two most promising trump suits.
  function rolloutEstimate(p){
  const hand=G.hands[p];
  const suits=SUITS.slice().sort((a,b)=>suitScore(hand,b)-suitScore(hand,a)).slice(0,2);
  const pool=mkDeck().filter(c=>!hand.some(h=>h.id===c.id));
  const N=20,deals=[];
  for(let i=0;i<N;i++){shuffle(pool);deals.push(pool.slice());}
  let best={est:0,trump:suits[0]};
  for(const t of suits){
    const res=[];
    for(const d of deals){
      const hands=[[],[],[],[]];let k=0;
      for(let q=0;q<4;q++){if(q===p)hands[q]=hand.slice();else{hands[q]=d.slice(k,k+13);k+=13;}}
      const kitty=d.slice(k,k+5);
      const st={scores:[0,0],dealer:G.dealer,handNo:0,log:[],winner:null,hands,kitty,trump:t,bidWinner:p,contract:0,discards:[],
        bid:G.bid,turn:(G.dealer+1)%4,trick:[],tricksWon:[0,0],ptsWon:[0,0],played:[],voids:[{},{},{},{}],est:[0,0,0,0],phase:'play'};
      res.push(withSim(st,()=>{
        G.hands[p].push(...kitty);const ds=aiDiscards(p);G.discards=ds;G.hands[p]=G.hands[p].filter(c=>!ds.includes(c));
        playOut();return G.ptsWon[p%2];
      }));
    }
    res.sort((a,b)=>a-b);
    const q=res[Math.floor(res.length*0.4)];
    if(q>best.est)best={est:q,trump:t};
  }
  return best;
  }

  /* ---------- table API ---------- */
  function pending(){
    if(!G)return null;
    switch(G.phase){
      case 'bid':return opts.isHuman(G.turn)?null:{delay:900,run:()=>bidAction(G.turn,aiBid(G.turn))};
      case 'trump':case 'kitty':return opts.isHuman(G.bidWinner)?null:{delay:1000,run:aiFinishKitty};
      case 'play':return opts.isHuman(G.turn)?null:{delay:800,run:()=>{const p=G.turn;playCard(p,aiChoose(p));}};
      case 'trickEnd':return {delay:1400,run:resolveTrick};
      case 'redeal':return {delay:1600,run:deal};
    }
    return null;
  }
  function act(p,a){
    if(!G)return 'The game has not started.';
    switch(a&&a.type){
      case 'bid':{
        if(G.phase!=='bid'||G.turn!==p)return 'It is not your turn to bid.';
        if(a.amt===null){bidAction(p,null);return null;}
        const amt=Number(a.amt),need=G.bid.high?G.bid.high+5:5;
        if(!(Number.isInteger(amt)&&amt%5===0&&amt>=need&&amt<=MAXBID))return 'Bid at least '+need+', in steps of 5.';
        bidAction(p,amt);return null;
      }
      case 'trump':
        if(G.phase!=='trump'||G.bidWinner!==p)return 'You are not naming trump.';
        if(!SUITS.includes(a.suit))return 'Pick one of the four suits.';
        nameTrump(p,a.suit);return null;
      case 'discard':{
        if(G.phase!=='kitty'||G.bidWinner!==p)return 'You are not discarding.';
        const ids=Array.isArray(a.ids)?[...new Set(a.ids)]:[];
        const ds=G.hands[p].filter(c=>ids.includes(c.id));
        if(ids.length!==5||ds.length!==5)return 'Choose exactly 5 cards from your hand.';
        if(ds.some(isCounter))return 'Counters and the Rook cannot be discarded.';
        doDiscard(p,ds);return null;
      }
      case 'play':{
        if(G.phase!=='play'||G.turn!==p)return 'It is not your turn.';
        const c=legal(p).find(x=>x.id===a.id);
        if(!c)return 'You have to follow suit if you can.';
        playCard(p,c);return null;
      }
      case 'next':
        if(G.phase!=='handEnd'||G.winner!==null)return 'The hand is not over.';
        nextHand();return null;
      case 'newgame':
        if(G.phase!=='handEnd'||G.winner===null)return 'The game is not over.';
        newGame();return null;
    }
    return 'Unknown action.';
  }
  function view(p){
    if(!G)return null;
    const v={phase:G.phase,dealer:G.dealer,handNo:G.handNo,scores:G.scores,bid:G.bid,turn:G.turn,trump:G.trump,
      bidWinner:G.bidWinner,contract:G.contract,trick:G.trick,tricksWon:G.tricksWon,ptsWon:G.ptsWon,trickWinner:G.trickWinner,
      lastTrick:G.lastTrick,result:G.result,winner:G.winner,log:G.log.slice(0,40),counts:G.hands.map(h=>h.length),target:TARGET,maxBid:MAXBID};
    if(p!==null&&p!==undefined&&p>=0){
      v.hand=G.hands[p];
      if(G.phase==='play'&&G.turn===p)v.legal=legal(p).map(c=>c.id);
      if(G.bidWinner===p&&G.kittyIds)v.kittyIds=G.kittyIds;
      if(G.phase==='trump'&&G.bidWinner===p)v.suggestTrump=bestSuit(G.hands[p]);
      if(G.phase==='kitty'&&G.bidWinner===p)v.suggestDiscards=aiDiscards(p).map(c=>c.id);
    }
    return v;
  }
  return {newGame,act,pending,view,state:()=>G,load:s=>{G=s;}};
}
module.exports={createEngine,SUITS,SN,TARGET,MAXBID};
