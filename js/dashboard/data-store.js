// data-store.js — Global state + statutory data constants
// The Comp Desk / Comp Buddy
(function() {
'use strict';
window.CD = window.CD || {};

const S={
  tab:'fee',sub:'ccp',
  // AWW
  aww:'',doa:'',
  amendAWW:false, priorAWW:'', newAWW:'', amendDiff:false,
  concur:false, concAWW:'',
  // CCP — desig includes RE/HIA; rows carry per-period rate-mode, amending, and
  // employer-reimbursement (REIMB ER) fields for full parity with the website.
  ccpRows:[{start:'',end:'',rate:'',ratePct:'',desig:'TT',curEarn:'',rateMode:'pct',amending:false,priorMode:'pct',priorVal:'',reimbErOn:false,reimbErAmount:'',reimbErScope:'period'}],
  ccp:'',ccpPrior:'',ccpContinuing:false,ccpRounding:'tenth',
  // SLU Fee — tile-level PHP (§15(4-a), shared longest hp) + §15(3)(w) prior weeks
  sluEntries:[{part:'Leg',pct:''}],sluPrior:'',sluPhpWks:'',sluPriorWks:'',
  // LWEC
  lwecPct:'',lwecFPW:'',lwecPriorWks:'',
  // Section 32 Settlement
  settleAmt:'',settleMsaType:'none',settleMsaMode:'usd',settleMsa:'',settleMsaPct:'5',
  // Burns (3rd-party lien apportionment)
  burnIndem:'',burnMed:'',burnGross:'',burnFee:'',burnDisb:'',burnMVA:false,burnThreshold:'50000',
  // AWW Calc — method: 'mult' §14(1)/(2) | 'straight' §14(3)/(4) catchall | 'hourly'
  awwDPW:'5',awwSal:'',awwDP:'',awwHourly:false,awwHR:'',awwHPW:'',
  awwMethod:'mult',awwStraightEarn:'',awwStraightWeeks:'',awwTips:'',awwBoard:'',
  // SLU Check
  sluBP:'Knee',sluROMs:{},
  // NS
  nsSub:'spine',nsSpineTbl:'11.1',
  nsReg:'cervical',nsImg:false,nsEMG:false,nsRef:'normal',nsTen:false,nsMot:'5',nsSen:'normal',nsRoot:'C7',nsAddR:'0',
};

// Effective AWW considering toggles
// Note: uses CD.pF (from calc-engine.js) — safe because effAWW is only called at render time
function effAWW(){
  const _pF = CD.pF || function(v){return parseFloat(v)||0;};
  if(S.concur){
    const primary=_pF(S.aww), conc=_pF(S.concAWW);
    return primary+conc; // Composite AWW
  }
  if(S.amendAWW) return _pF(S.newAWW);
  return _pF(S.aww);
}
function effTT(){return(effAWW()*2)/3;}

// ─── STATUTORY DATA ───
const MAX_RATES=[
  {s:"2026-07-01",e:"2099-12-31",l:"Jul 1, 2026+",max:1281.50},
  {s:"2025-07-01",e:"2026-06-30",l:"Jul 1, 2025 – Jun 30, 2026",max:1222.42},
  {s:"2024-07-01",e:"2025-06-30",l:"Jul 1, 2024 – Jun 30, 2025",max:1171.46},
  {s:"2023-07-01",e:"2024-06-30",l:"Jul 1, 2023 – Jun 30, 2024",max:1145.43},
  {s:"2022-07-01",e:"2023-06-30",l:"Jul 1, 2022 – Jun 30, 2023",max:1125.46},
  {s:"2021-07-01",e:"2022-06-30",l:"Jul 1, 2021 – Jun 30, 2022",max:1063.05},
  {s:"2020-07-01",e:"2021-06-30",l:"Jul 1, 2020 – Jun 30, 2021",max:966.78},
  {s:"2019-07-01",e:"2020-06-30",l:"Jul 1, 2019 – Jun 30, 2020",max:934.11},
  {s:"2018-07-01",e:"2019-06-30",l:"Jul 1, 2018 – Jun 30, 2019",max:904.74},
  {s:"2017-07-01",e:"2018-06-30",l:"Jul 1, 2017 – Jun 30, 2018",max:870.61},
  {s:"2016-07-01",e:"2017-06-30",l:"Jul 1, 2016 – Jun 30, 2017",max:864.32},
  {s:"2015-07-01",e:"2016-06-30",l:"Jul 1, 2015 – Jun 30, 2016",max:844.29},
  {s:"2014-07-01",e:"2015-06-30",l:"Jul 1, 2014 – Jun 30, 2015",max:808.65},
  {s:"2013-07-01",e:"2014-06-30",l:"Jul 1, 2013 – Jun 30, 2014",max:803.21},
  {s:"2012-07-01",e:"2013-06-30",l:"Jul 1, 2012 – Jun 30, 2013",max:792.07},
  {s:"2011-07-01",e:"2012-06-30",l:"Jul 1, 2011 – Jun 30, 2012",max:772.96},
  {s:"2010-07-01",e:"2011-06-30",l:"Jul 1, 2010 – Jun 30, 2011",max:739.83},
  {s:"2009-07-01",e:"2010-06-30",l:"Jul 1, 2009 – Jun 30, 2010",max:600},
  {s:"2008-07-01",e:"2009-06-30",l:"Jul 1, 2008 – Jun 30, 2009",max:550},
  {s:"2007-07-01",e:"2008-06-30",l:"Jul 1, 2007 – Jun 30, 2008",max:500},
  {s:"1992-07-01",e:"2007-06-30",l:"Jul 1, 1992 – Jun 30, 2007",max:400},
  {s:"1991-07-01",e:"1992-06-30",l:"Jul 1, 1991 – Jun 30, 1992",max:350},
  {s:"1990-07-01",e:"1991-06-30",l:"Jul 1, 1990 – Jun 30, 1991",max:340},
  {s:"1985-07-01",e:"1990-06-30",l:"Jul 1, 1985 – Jun 30, 1990",max:300},
];
const MIN_RATES=[
  {s:"2027-07-01",e:"2099-12-31",l:"Jul 1, 2027+",min:null,n:"1/5 NYSAWW (indexed)"},
  {s:"2026-07-01",e:"2027-06-30",l:"Jul 1, 2026 – Jun 30, 2027",min:384.45,n:"1/5 NYSAWW (2025)"},
  {s:"2025-01-01",e:"2026-06-30",l:"Jan 1, 2025 – Jun 30, 2026",min:325,n:""},
  {s:"2024-01-01",e:"2024-12-31",l:"Jan 1, 2024 – Dec 31, 2024",min:275,n:""},
  {s:"2013-05-01",e:"2023-12-31",l:"May 1, 2013 – Dec 31, 2023",min:150,n:""},
  {s:"2007-07-01",e:"2013-04-30",l:"Jul 1, 2007 – Apr 30, 2013",min:100,n:"2007 Reform"},
  {s:"1900-01-01",e:"2007-06-30",l:"Before Jul 1, 2007",min:40,n:"Pre-reform"},
];
const SLU_BP=[
  {n:"Arm",w:312,hp:32},{n:"Hand",w:244,hp:32},{n:"Leg",w:288,hp:40},{n:"Foot",w:205,hp:32},
  {n:"Thumb",w:75,hp:24},{n:"1st Finger (Index)",w:46,hp:18},{n:"2nd Finger (Middle)",w:30,hp:12},
  {n:"3rd Finger (Ring)",w:25,hp:8},{n:"4th Finger (Pinky)",w:15,hp:8},{n:"Great Toe",w:38,hp:12},
  {n:"Other Toe (2)",w:16,hp:8},{n:"Other Toe (3)",w:16,hp:8},{n:"Other Toe (4)",w:16,hp:8},{n:"Other Toe (5)",w:16,hp:8},
  {n:"Eye",w:160,hp:20},{n:"One Ear",w:60,hp:0},{n:"Binaural",w:150,hp:0},
];
const LWEC_BR=[
  {l:"Total (Industrial)",mw:"Lifetime"},{l:"96%+",lo:96,hi:100,mw:525},{l:"91–95%",lo:91,hi:95,mw:500},
  {l:"86–90%",lo:86,hi:90,mw:475},{l:"81–85%",lo:81,hi:85,mw:450},{l:"76–80%",lo:76,hi:80,mw:425},
  {l:"71–75%",lo:71,hi:75,mw:400},{l:"61–70%",lo:61,hi:70,mw:375},{l:"51–60%",lo:51,hi:60,mw:350},
  {l:"41–50%",lo:41,hi:50,mw:300},{l:"31–40%",lo:31,hi:40,mw:275},{l:"16–30%",lo:16,hi:30,mw:250},
  {l:"15% or less",lo:0,hi:15,mw:225},
];
// ROM Data
const ROM_DATA={
  Shoulder:{convertsTo:"Arm",movements:[
    {name:"Fwd Flexion",full:180,tiers:[{l:"Full→Mild",f:180,t:150,s:0,e:.075,p:.0025},{l:"Mild→Mod",f:150,t:120,s:.075,e:.20,p:.004167},{l:"Mod→Mrkd",f:120,t:60,s:.20,e:.40,p:1/300},{l:"Mrkd→Anky",f:60,t:0,s:.40,e:.50,p:1/600}]},
    {name:"Abduction",full:180,tiers:[{l:"Full→Mild",f:180,t:150,s:0,e:.05,p:1/600},{l:"Mild→Mod",f:150,t:90,s:.05,e:.15,p:1/600},{l:"Mod→Mrkd",f:90,t:45,s:.15,e:.25,p:1/450},{l:"Mrkd→Anky",f:45,t:0,s:.25,e:.35,p:1/450}]},
    {name:"Int Rotation",full:80,tiers:[{l:"Full→Mild",f:80,t:60,s:0,e:.025,p:.00125},{l:"Mild→Mod",f:60,t:30,s:.025,e:.075,p:1/600},{l:"Mod→Mrkd",f:30,t:0,s:.075,e:.10,p:1/1200}]},
    {name:"Ext Rotation",full:90,tiers:[{l:"Full→Mild",f:90,t:60,s:0,e:.025,p:1/1200},{l:"Mild→Mod",f:60,t:30,s:.025,e:.075,p:1/600},{l:"Mod→Mrkd",f:30,t:0,s:.075,e:.10,p:1/1200}]},
  ]},
  Elbow:{convertsTo:"Arm",movements:[
    {name:"Flexion",full:140,tiers:[{l:"Full→Mild",f:140,t:110,s:0,e:.075,p:.0025},{l:"Mild→Mod",f:110,t:90,s:.075,e:.15,p:.00375},{l:"Mod→Mrkd",f:90,t:60,s:.15,e:.25,p:1/300},{l:"Mrkd→Anky",f:60,t:0,s:.25,e:.35,p:1/600}]},
    {name:"Pronation",full:80,tiers:[{l:"Full→Mild",f:80,t:60,s:0,e:.025,p:.00125},{l:"Mild→Mod",f:60,t:30,s:.025,e:.075,p:1/600},{l:"Mod→Mrkd",f:30,t:0,s:.075,e:.10,p:1/1200}]},
    {name:"Supination",full:80,tiers:[{l:"Full→Mild",f:80,t:60,s:0,e:.025,p:.00125},{l:"Mild→Mod",f:60,t:30,s:.025,e:.075,p:1/600},{l:"Mod→Mrkd",f:30,t:0,s:.075,e:.10,p:1/1200}]},
  ]},
  Wrist:{convertsTo:"Hand",movements:[
    {name:"Palmar Flex",full:80,tiers:[{l:"Full→Mild",f:80,t:60,s:0,e:.05,p:.0025},{l:"Mild→Mod",f:60,t:30,s:.05,e:.15,p:1/300},{l:"Mod→Mrkd",f:30,t:0,s:.15,e:.25,p:1/300}]},
    {name:"Dorsiflexion",full:70,tiers:[{l:"Full→Mild",f:70,t:50,s:0,e:.05,p:.0025},{l:"Mild→Mod",f:50,t:25,s:.05,e:.15,p:.004},{l:"Mod→Mrkd",f:25,t:0,s:.15,e:.25,p:.004}]},
    {name:"Radial Dev",full:20,tiers:[{l:"Full→Mild",f:20,t:10,s:0,e:.025,p:.0025},{l:"Mild→Mod",f:10,t:0,s:.025,e:.05,p:.0025}]},
    {name:"Ulnar Dev",full:30,tiers:[{l:"Full→Mild",f:30,t:20,s:0,e:.025,p:.0025},{l:"Mild→Mod",f:20,t:10,s:.025,e:.05,p:.0025},{l:"Mod→Mrkd",f:10,t:0,s:.05,e:.075,p:.0025}]},
  ]},
  Knee:{convertsTo:"Leg",movements:[
    {name:"Flexion",full:140,tiers:[{l:"Full→Mild",f:140,t:120,s:0,e:.10,p:.005},{l:"Mild→Mod",f:120,t:90,s:.10,e:.40,p:.01},{l:"Mod→Mrkd",f:90,t:45,s:.40,e:.55,p:1/300},{l:"Mrkd→Anky",f:45,t:0,s:.55,e:.6667,p:1/300}]},
    {name:"Ext Deficit",full:0,isDef:true,tiers:[{l:"Mild (5-10°)",flat:true,sr:[.075,.10]}],note:"5-10° deficit = 7.5–10% SLU of leg."},
  ]},
  Hip:{convertsTo:"Leg",movements:[
    {name:"Flexion",full:130,tiers:[{l:"Full→Mild",f:130,t:100,s:0,e:.075,p:.0025},{l:"Mild→Mod",f:100,t:60,s:.075,e:.25,p:.004375},{l:"Mod→Mrkd",f:60,t:30,s:.25,e:.40,p:.005},{l:"Mrkd→Anky",f:30,t:0,s:.40,e:.50,p:1/300}]},
    {name:"Abduction",full:40,tiers:[{l:"Full→Mild",f:40,t:30,s:0,e:.025,p:.0025},{l:"Mild→Mod",f:30,t:15,s:.025,e:.075,p:1/300},{l:"Mod→Mrkd",f:15,t:0,s:.075,e:.10,p:1/600}]},
    {name:"Int Rotation",full:40,tiers:[{l:"Full→Mild",f:40,t:25,s:0,e:.025,p:1/600},{l:"Mild→Mod",f:25,t:15,s:.025,e:.05,p:.0025},{l:"Mod→Mrkd",f:15,t:0,s:.05,e:.075,p:1/600}]},
    {name:"Ext Rotation",full:60,tiers:[{l:"Full→Mild",f:60,t:40,s:0,e:.025,p:.00125},{l:"Mild→Mod",f:40,t:20,s:.025,e:.05,p:.00125},{l:"Mod→Mrkd",f:20,t:0,s:.05,e:.075,p:.00125}]},
  ]},
  Ankle:{convertsTo:"Foot",movements:[
    {name:"Dorsiflexion",full:20,tiers:[{l:"Full→Mild",f:20,t:10,s:0,e:.075,p:.0075},{l:"Mild→Mod",f:10,t:0,s:.075,e:.20,p:.0125}]},
    {name:"Plantar Flex",full:50,tiers:[{l:"Full→Mild",f:50,t:30,s:0,e:.05,p:.0025},{l:"Mild→Mod",f:30,t:15,s:.05,e:.15,p:1/150},{l:"Mod→Mrkd",f:15,t:0,s:.15,e:.25,p:1/150}]},
    {name:"Inversion",full:30,tiers:[{l:"Full→Mild",f:30,t:20,s:0,e:.05,p:.005},{l:"Mild→Mod",f:20,t:10,s:.05,e:.10,p:.005},{l:"Mod→Mrkd",f:10,t:0,s:.10,e:.15,p:.005}]},
    {name:"Eversion",full:20,tiers:[{l:"Full→Mild",f:20,t:10,s:0,e:.05,p:.005},{l:"Mild→Mod",f:10,t:0,s:.05,e:.10,p:.005}]},
  ]},
};
const ALL_BP_NAMES=Object.keys(ROM_DATA);
const SPINE_T={"11.1":{n:"Soft Tissue–Non-Surg",cls:[{c:1,d:"No symptoms, no findings",cv:"None",th:"None",lu:"None"},{c:2,d:"Symptoms, no obj findings, no imaging",cv:"A",th:"A",lu:"A"},{c:3,d:"Symptoms, no obj findings, correlative imaging",cv:"B",th:"B",lu:"B"},{c:4,d:"Symptoms + obj findings + imaging/EMG",cv:"C–H",th:"C–G",lu:"D–J"}]},"11.2":{n:"Surgically Treated",cls:[{c:1,d:"Surgery, no residual symptoms",cv:"None",th:"None",lu:"None"},{c:2,d:"Surgery, symptoms, no findings/imaging",cv:"A",th:"A",lu:"A"},{c:3,d:"Surgery, symptoms, post-surg imaging",cv:"B",th:"B",lu:"B"},{c:4,d:"Surgery, symptoms + findings + imaging/EMG",cv:"C–H",th:"C–G",lu:"D–J"},{c:5,d:"Complications related to surgery",cv:"Varies",th:"Varies",lu:"Varies"}]}};
const MOT_GR=[{g:0,d:"No contractions",p:20},{g:1,d:"Slight contraction",p:20},{g:2,d:"Gravity eliminated",p:18},{g:3,d:"Against gravity",p:6},{g:4,d:"Against gravity+resist",p:0},{g:5,d:"Full",p:0}];
const C_ROOTS=[{r:"C5"},{r:"C6"},{r:"C7"},{r:"C8"},{r:"T1"}];
const L_ROOTS=[{r:"L3"},{r:"L4"},{r:"L5"},{r:"S1"}];
const CT_RK=[{l:"C",mn:0,mx:0},{l:"D",mn:4,mx:16},{l:"E",mn:17,mx:32},{l:"F",mn:33,mx:48},{l:"G",mn:49,mx:64},{l:"H",mn:65,mx:80}];
const L_RK=[{l:"D",mn:0,mx:0},{l:"E",mn:4,mx:16},{l:"F",mn:17,mx:32},{l:"G",mn:33,mx:48},{l:"H",mn:49,mx:64},{l:"I",mn:65,mx:80},{l:"J",mn:81,mx:92}];
const BRAIN=[{c:1,d:"No residual symptoms",r:"None"},{c:2,d:"Nuisance-level, independent (Rancho 9-10)",r:"A–C"},{c:3,d:"Independent w/ adaptations (Rancho 8)",r:"F–L"},{c:4,d:"Not fully independent (Rancho 7)",r:"Q–S"},{c:5,d:"Dependent/total supervision (Rancho 4-6)",r:"W–Z"},{c:6,d:"Comatose (Rancho 1-3)",r:"Z"}];
const XWALK={"Cervical":{1:"0",2:"A–C",3:"D–E",4:"F–G",5:"H"},"Thoracic":{1:"0",2:"A–C",3:"D–E",4:"F–G"},"Lumbar":{1:"0",2:"A–B,D",3:"E–F",4:"G–H",5:"I–J"},"Brain":{1:"0",2:"A–C",3:"F–L",4:"Q–S",5:"W–Z",6:"Z"},"Skin":{1:"0",2:"A–C",3:"G–J",4:"O–R",5:"U–Z"}};

CD.S = S;
CD.effAWW = effAWW;
CD.effTT = effTT;
CD.MAX_RATES = MAX_RATES;
CD.MIN_RATES = MIN_RATES;
CD.SLU_BP = SLU_BP;
CD.LWEC_BR = LWEC_BR;
CD.ROM_DATA = ROM_DATA;
CD.ALL_BP_NAMES = ALL_BP_NAMES;
CD.SPINE_T = SPINE_T;
CD.MOT_GR = MOT_GR;
CD.C_ROOTS = C_ROOTS;
CD.L_ROOTS = L_ROOTS;
CD.CT_RK = CT_RK;
CD.L_RK = L_RK;
CD.BRAIN = BRAIN;
CD.XWALK = XWALK;
})();
