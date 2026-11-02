# One rule, one place

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: adding or consolidating a rule several screens share. Index: `CLAUDE.md`.

## One rule, one place

Ajay, 2026-10-13, after the two above: "make sure the underlying pieces/modules
are in line and built as shareable vs every screen/function/round using different
logic or their own way" and "start from the basic and then move step by step up".

The browser tests found neither fault above, because every screen was right on
its own terms. **Two screens answering one question differently is the class a
screen test cannot see**, and it was three of the day's findings: thirteen places
pricing a round, nine readers with five fields, five builders of a flight's tees.

`docs/one-rule-one-place.md` is the inventory (measured, with file and line) and
the order: what people type, the field, the venue, handicaps, a card, a round,
across rounds, money, what screens say. For each rule the shape is the same:

1. **One function holds it, and takes what it needs as REQUIRED arguments**, so
   that the compiler lists every caller the day the rule grows. An optional
   argument is a caller free to forget.
2. **One test worked from the Rules of Golf**, by a route the code does not take,
   on the axis the fixtures have been missing.
3. **One sweep that refuses a second copy**, with a control proving it can see
   one.

And two cautions this file already carries, which apply to every step of it: a
single reader must be pinned to the RULES, because readers that agree by
construction agree whether or not they are right; and a dead twin of a live rule
(`courseHandicapForPlayer`, deleted that day with no callers) is a second copy
waiting to be used.
