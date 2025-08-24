chrome.runtime.onInstalled.addListener(() => {
	// Optional: ping the bridge at install time
	fetch("http://127.0.0.1:5000/health").catch(() => {});
});
