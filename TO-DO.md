## Oustanding tasks

* PRI: countdown is messy, need to fix
* PRI: Fixed points need better visuability
* Refactor player snapshots for larger games: the server currently sends every phone a full snapshot containing the entire player roster on frequent broadcasts. Because snapshot size and recipient count both grow with player count, traffic and serialization grow roughly quadratically. Define a small player-specific snapshot with only the current question/phase, timer, the player's own status and score, and data the phone actually displays. Keep full snapshots for host and TV; send roster/leaderboard changes only when needed and animate countdowns locally between updates. Verify reconnects, buzzes, typed submissions, results, and privacy, then load-test bandwidth, CPU, and buzz latency at 50/100/300 players before raising the player cap.
* Single beep sounds instead of one file with many beeps.
* Buzzer sound
* Test sound effects
* Deleting numbers in quiz editor leaves 0
