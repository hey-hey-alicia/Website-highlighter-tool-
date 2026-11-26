// Margin — background service worker: context menu + keyboard shortcuts.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'mn-highlight', title: 'Highlight', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'mn-note', title: 'Highlight and add note', contexts: ['selection'] });
  });
});

function send(tab, msg) {
  if (tab && tab.id != null) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  send(tab, { type: 'highlight-selection', note: info.menuItemId === 'mn-note' });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  send(tab, { type: 'highlight-selection', note: command === 'highlight-note' });
});
