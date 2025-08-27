chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
	if (msg.action === "runCommand") {
		const cmd = msg.command;

		if (cmd.includes("open youtube")) {
			// Example: if you say "open youtube and play song name"
			const match = cmd.match(/play (.+)/);
			let query = match ? encodeURIComponent(match[1]) : "";
			chrome.tabs.create({
				url: "https://www.youtube.com/results?search_query=" + query,
			});
		} else if (cmd.includes("fill this form")) {
			// Inject content script to fill forms
			chrome.scripting.executeScript({
				target: { tabId: sender.tab.id },
				files: ["content.js"],
			});
		}
	}
});
