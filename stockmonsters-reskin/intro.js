/**
 * The opening monologue (text file 2), rewritten.
 *
 * The original was a PokémonSDK tech-demo pitch. This replaces it with Kelby
 * introducing the Marketlands, the 194 Stockmonsters, and $AGORA.
 *
 * Structure is load-bearing and must not change:
 *   - row 9  is a yes/no question; rows 10-13 are its two branches
 *   - rows 15/16 are the appearance choice options ("Left"/"Right")
 *   - row 17 precedes name entry; row 18 must keep \n[1] (the player's name)
 * Reordering or adding rows would desynchronise the RMXP event that drives it.
 */
export const INTRO = {
  0: ':[name=???]:Welcome to the Marketlands, Hunter.',
  1: ':[name=Kelby]:I am Kelby,[WAIT 40] and these are my desk partners Ragan,[WAIT 100] Trippy,[WAIT 100] Gambino,[WAIT 100] Rez,[WAIT 100] and Gareth![WAIT 100]',
  2: ':[name=Kelby]:Stockmonsters is a living market. Every company traded on-chain walks this world as a creature.',
  3: ':[name=Kelby]:Capital here is not a number on a screen. It is Flow, and every creature you meet runs on it.',
  4: ':[name=Kelby]:There are 194 of them out there, one for each token on the Robinhood Chain. Track them, capture them, train them.',
  5: ':[name=Kelby]:Everything settles in $AGORA, the currency of the Marketlands and the reserve this whole ecosystem is built on.',
  6: ':[name=Kelby]:You will soon arrive on the Island, a stretch of the Marketlands opened up for new Hunters.',
  7: ":[name=Kelby]:Start at the Tower. That is where a Hunter's journey begins, and someone is waiting for you there.",
  8: ':[name=Kelby]:Before you head out, I need a few details for your Hunter licence.',
  9: ':[name=Kelby]:Do you know how to change your controls?',
  10: ":[name=Kelby]:Good. Then let's move on.",
  11: ':[name=Kelby]:To change your controls, press the F1 button at any point after this introduction!',
  12: ':[name=Kelby]:You can then modify your controls as you see fit.',
  13: ":[name=Kelby]:Let's move on to the next question.",
  14: ':[name=Kelby]:Which appearence defines you the best?',
  15: 'Left',
  16: 'Right',
  17: ':[name=Kelby]:Finally, what name do you trade under?',
  18: ':[name=Kelby]:\\n[1]? The market will remember that one.\\nlDid I write it properly?',
  19: ":[name=Kelby]:You're registered, Hunter.",
  20: ':[name=Kelby]:The Marketlands are open. Go build a portfolio worth talking about.',
  21: ':[name=Kelby]:Good hunting!',
};
