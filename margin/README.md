<p align="center"><img src="docs/icon.png" width="96" alt="Margin icon"></p>

<h1 align="center">Margin</h1>
<p align="center"><b>Private highlights and notes for any web page.</b><br>
Highlight text on any website, add a note, and find it there next time. Everything stays in your own browser.</p>

![Margin showing highlights with notes in a side panel](docs/screenshot.png)

## Features

- **Highlight anything:** select text on any page and pick one of five colours.
- **Side-panel notes:** each note sits beside its highlight and scrolls with the article.
- **Stays out of the way:** minimise a note and it disappears until you click its highlight again. You can also hide the whole panel with one click.
- **Comes back when you do:** highlights reappear when you revisit a page, even if the page loads slowly or the layout shifts.
- **All your notes in one place:** search every highlight and note across every site you've saved.
- **Private by design:** no account and no server. The extension makes no network requests at all.
- **Backup and move:** export your notes to a JSON file and import them in another browser.

## Install

Margin works in Chrome, Edge, Brave, Arc and other Chromium browsers.

1. Download this repository: click **Code → Download ZIP**, then unzip it.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder (the one containing `manifest.json`).
5. Refresh any tabs that were already open.

Keep the folder after installing, because the browser loads the extension from it.

## How to use

| To… | Do this |
| --- | --- |
| Highlight | Select text, then click a colour in the toolbar that appears |
| Highlight and add a note | Select text and click **✎ Note** (or right-click → *Highlight and add note*) |
| Save a note | Click **Save**, press <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd>, or click anywhere on the page |
| Edit a note | Click the note text or **Edit** on its card, or click the highlight |
| Minimise a note | Click **–** on its card. It disappears so it won't cover the page, and an orange dot stays on the highlight |
| See a minimised note again | Click the highlight (or hover over it to read the note) |
| Hide or show all notes | Use the **Hide notes / Show notes** button in the bottom-right corner. If every note is minimised, **Show notes** brings them all back |
| Open a note on a highlighted link | <kbd>Alt</kbd>+click the highlight |
| See every note | Click the Margin toolbar icon, then **All notes →** |

Keyboard shortcuts: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> highlights the selection, and <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> highlights it and adds a note. You can change them at `chrome://extensions/shortcuts`.

## Privacy

Your highlights and notes are saved with `chrome.storage.local` on your own computer. They never leave your browser. Margin has no analytics, no tracking, no accounts and no network code.

When you install it, Chrome warns that the extension can *"read and change all your data on all websites"*. Margin needs that permission to draw highlights on the pages you visit.

## Limitations

- Notes don't sync between devices automatically. Use **Export backup** and **Import** on the All notes page to move them.
- Margin doesn't work in Chrome's built-in PDF viewer, on `chrome://` pages, or in the Chrome Web Store.
- If a page's wording changes a lot, a highlight may no longer be found. Its note is kept and listed in the popup as "not found on page".
- To use Margin on local `file://` pages, turn on **Allow access to file URLs** in the extension's details.

## Project structure

```
manifest.json    Extension manifest (Manifest V3)
content.js       Runs on each page: selection toolbar, highlight anchoring, side-panel notes
content.css      Highlight styles
background.js    Right-click menu and keyboard shortcuts
popup.html/.js   Toolbar popup: notes on the current page
notes.html/.js   "All notes" page: search, edit, export and import
shared.css       Styles shared by the popup and All notes page
icons/           Extension icons
```

## License

[MIT](LICENSE)
