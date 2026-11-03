## Oustanding tasks

* Playtest the third question mode, **Type + buzz** (`type-and-buzz`), alongside the existing buzzer and typed modes:
  * Quiz fields: `fixedPoints` for the typed reward, `buzzPoints` for the larger fixed buzzer reward, and `typingSeconds` for the typing-only window. `timerSeconds` is the buzzer countdown override.
  * Players can buzz immediately after submitting a typed answer. Others can buzz when the initial window ends; after a wrong buzz all eligible players can buzz. Close typed submissions on the first buzz, or when the buzzer timer expires if nobody buzzes.
  * Award a smaller fixed amount for a correct typed answer. A correct buzz earns a larger fixed award; a wrong buzz loses half (rounded up) and lets eligible players buzz again. Typed submissions stay closed after the first buzz. Players can earn both awards.
  * Review typed answers after the buzzer round, using fast review. Buzzer points are fixed without decay: speed still matters because the first buzz closes typing.
  * Show a brief rules overlay before the question and update the phone, TV and host screens to make each stage and its rewards clear.
* PRI: countdown is messy, need to fix - FIXED
* PRI: Fixed points need better visuability - FIXED
* Refactor player snapshots for larger games: the server currently sends every phone a full snapshot containing the entire player roster on frequent broadcasts. Because snapshot size and recipient count both grow with player count, traffic and serialization grow roughly quadratically. Define a small player-specific snapshot with only the current question/phase, timer, the player's own status and score, and data the phone actually displays. Keep full snapshots for host and TV; send roster/leaderboard changes only when needed and animate countdowns locally between updates. Verify reconnects, buzzes, typed submissions, results, and privacy, then load-test bandwidth, CPU, and buzz latency at 50/100/300 players before raising the player cap.
* Single beep sounds instead of one file with many beeps.
* Buzzer sound
* Test sound effects
* Deleting numbers in quiz editor leaves 0
