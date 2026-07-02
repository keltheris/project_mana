# MTG Art Picker

A tool for picking exact card printings/art for your Magic: The Gathering decklist, using live data from Scryfall.

## Deploy in 30 seconds (no account required)

1. Unzip this project.
2. Go to https://app.netlify.com/drop in your browser.
3. Drag the `dist` folder onto the page.
4. Netlify gives you a live URL instantly (e.g. `random-name-123.netlify.app`) — share that link with friends.

That's it. The site is fully static and calls the Scryfall API directly from the browser, so no backend or server is needed.

## Making edits later

If you want to change anything and rebuild:

```bash
npm install
npm run dev      # local dev server for testing changes
npm run build     # rebuilds the dist/ folder for redeploying
```

Then drag the new `dist` folder onto Netlify Drop again (same site or a new one).

## Optional: connect to GitHub for auto-deploys

If you'd rather have every future `git push` automatically redeploy the site:
1. Create a GitHub repo and push this project to it.
2. In Netlify, choose "Import from Git" instead of drag-and-drop, and point it at the repo.
3. Every push to the main branch will then auto-rebuild and redeploy.
