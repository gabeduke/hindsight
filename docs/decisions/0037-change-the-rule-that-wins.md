# 0037. Change the rule that wins, not one a later rule overrides

**Date:** 2026-10-24 (47112dcf).

## Decision

Edit the declaration that takes effect. `lib/css-cascade.test.js` fails on a
declaration that a later rule, with the same selector in the same `@media`,
always overrides: delete it, or merge the two.

## Why

The deck's restyle set the keys and the fields again, in grouped lists,
three thousand lines below their first rules, and 181 first values stood
there reading like the answer while changing nothing.

## What it rules out

Restyling by appending overrides further down the file.
