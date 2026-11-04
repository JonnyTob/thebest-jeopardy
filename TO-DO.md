## Oustanding tasks

* Playtest the third question mode, **Type + buzz** (`type-and-buzz`), alongside the existing buzzer and typed modes:
  * Quiz fields: `fixedPoints` for the typed reward, `buzzPoints` for a fixed buzzer reward or `pointDecay` for decaying buzzer points, and `typingSeconds` for the initial typing window. `timerSeconds` is the buzzer countdown override.
  * Players can buzz immediately after submitting a typed answer. Others can buzz when the initial window ends; after a wrong buzz all eligible players can buzz. Close typed submissions on the first buzz, or when the buzzer timer expires if nobody buzzes.
  * Award a smaller fixed amount for a correct typed answer. A correct buzz earns a larger fixed award; a wrong buzz loses half (rounded up) and lets eligible players buzz again. Typed submissions stay closed after the first buzz. Players can earn both awards.
  * Review typed answers after the buzzer round, using fast review. Buzzer points can be fixed or decay; speed also matters because the first buzz closes typing.
  * Show a brief rules overlay before the question and update the phone, TV and host screens to make each stage and its rewards clear. - FIXED
* PRI: countdown is messy, need to fix - FIXED
* PRI: Fixed points need better visuability - FIXED
* Player snapshots for larger games: compact per-player snapshots, local countdowns and targeted submission updates implemented. Local loopback tests cover 50/100/300 simulated phones; validate bandwidth, server CPU and buzz latency on the intended hardware and Wi-Fi before raising the player cap.
* Single beep sounds instead of one file with many beeps.
* Buzzer sound
* Test sound effects
* Deleting numbers in quiz editor leaves 0
