# Money while a round is live

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: side games, pots, skins, Nassau, money shown mid-round. Index: `CLAUDE.md`.

## Money: what may be reported while a round is live

`money-layout.ts` opens with the rule — final only, never live. The part that is easy to get
wrong is deciding what "final" means for a bet that is not skins, and the instinct is to ask
**has the event happened**. That is the wrong question. Ask **can the amount still change**.

A birdie already made does not un-happen, which reads like a licence to pay a birdie pot as the
cards come in. It is not. The pot divides by the counts RELATIVE to each other, so one birdie on
the 3rd shows a player holding all of it and four more across the field leaves them a fifth. The
event is settled; the amount is not, and the amount is the part the ledger states. Low gross and
low net fail the same test more obviously — `lowScoreWinners` compares only the cards with the
MOST holes played, so mid-round it pays whoever is furthest round, a leader dressed as a winner.

A Nassau passes both tests and is correctly paid LIVE. `nassauNets` pays only segments
`resolveMatch` calls complete, and a finished front nine cannot be re-decided by a back nine
nobody has started. Gating it would be withholding a settled result — the opposite failure, and
just as wrong. So judge each side game on its own; they do not behave alike.

**The app says "side game", never "bet"** (Ajay, 2026-10-21: "side games will resonate with our
moto of no gambling"). On every screen, in the guide and in the player's Help, not only on the
public pages that ads land on. `public-pages-never-say-bet.test.ts` sweeps the whole of `src` for
the phrases a sentence makes of the word; `bet` as a code NAME (`bet.name`, `renameBet`) is fine.

Enforce it at the SINK, as `gameNets` now does for both the skins pots and the derived ones. The
caller that had it right — `roundMoneyFor`, which gates on `roundMoneyIsFinal` — and the caller
that had it wrong — `moneyFor`, which gates nothing — were reading the same function, so a third
written later cannot get it wrong by forgetting. Same shape as `standingRows` returning `[]` on
its first line for a manual format.

One trap when reusing the round card's finality: `matchSettled` is satisfied by a match with ONE
hole on it. That is loose enough for "which round are we on" and far too loose to release money.

What a player may still see mid-round is their EXPOSURE — `stakeFor`, which reads membership and
never touches a card. That half is honest, it is what the player walking to the first tee
actually wants, and it must stay.
