# Kaboot poster brief

Use this brief when creating future promotional posters for Kaboot. Adapt it to
any new instructions or references supplied for the specific poster.

## The product

Kaboot is a locally hosted multiplayer quiz. Friends join on their phones, type
answers and buzz in while a host runs the game and a TV shows the clues. The
poster should communicate the excitement of playing together.

The current brand name and tagline are in `settings.json`. At the time of this
brief they are **Kaboot** and **Buzz in. Get booted.** Check the file before
using them in a new poster; follow the user's requested wording if different.

## Default visual direction

- Create a fun, energetic promotional poster inspired by 1980s and 1990s movie,
  music, arcade and video-store culture.
- Show a diverse group of adult friends enjoying quiz night, laughing and using
  their phones. Keep the people and their reactions prominent.
- Use vibrant purple, magenta, turquoise and warm yellow, dynamic lighting,
  bold retro shapes and a subtle printed-poster texture.
- Feature the brand name prominently, with the tagline smaller and readable.
- Include a small, clearly secondary inset of the actual player screen using
  .skill/buzzer-screenshot.png as input.Do not let the inset cover faces.
- Use original, generic pop-culture imagery; Think boomboxes, rubiks cube, arcade games, walkman.
  Don't add event details, dates, URLs or extra copy
  unless requested.

The previous poster, [output/kaboot-retro-poster.png](output/kaboot-retro-poster.png),
can be used as a style reference if it is available. It is 1024 × 1536 pixels,
so do not assume it is suitable for large-format printing.

## Suggested workflow

1. Confirm the intended format, text and references from the user's request.
   Choose a portrait poster by default when no format is specified.
2. Use the available image-generation tool. Treat the player screenshot as a
   reference for the inset, not as a reference for the whole composition.
   Use a current supplied screenshot rather than assuming an old screenshot
   matches the current app.
3. Ask for the highest available output resolution appropriate to the format.
   Inspect the result for legible branding, a recognizable player screen,
   convincing hands and phones, and unwanted text.
4. Save the selected project asset in `output/` with a descriptive name. Do not
   overwrite an existing poster unless requested.
5. Report the saved path and actual pixel dimensions. If the output falls short
   of the requested print resolution, say so rather than calling it print-ready.

## Reusable prompt

> Create a high-resolution portrait promotional poster for Kaboot, a lively
> multiplayer quiz played on phones. Show a diverse group of adult friends
> having fun together, laughing and looking at their phones during a quiz night.
> Use an energetic 1980s–1990s movie, music and arcade poster aesthetic, with
> vivid purple, magenta, turquoise and warm yellow, dynamic lighting, bold shapes
> and subtle print texture. Include a small but recognizable inset based on the
> supplied Kaboot player-screen reference: dark purple interface, gold accents
> and a green circular BUZZ button. Keep the group prominent. Feature the exact
> brand name and tagline requested for this poster. Use original generic retro
> imagery; Make people group modern looking while keeping surrounding poster 80/90 style.
