const out = document.getElementById("out");
const stepsEl = document.getElementById("steps");
const headlessEl = document.getElementById("headless");
const statusEl = document.getElementById("status");
const statusTextEl = document.getElementById("statusText");
const startServerBtn = document.getElementById("startServer");

// Check server status on popup open
async function checkServerStatus() {
	try {
		const res = await fetch("http://127.0.0.1:5000/health", {
			method: "GET",
			signal: AbortSignal.timeout(3000), // 3 second timeout
		});
		if (res.ok) {
			statusEl.style.background = "#d4edda";
			statusEl.style.color = "#155724";
			statusTextEl.textContent = "✓ Server running";
			startServerBtn.style.display = "none";
		} else throw new Error("Server error");
	} catch (e) {
		statusEl.style.background = "#f8d7da";
		statusEl.style.color = "#721c24";
		statusTextEl.textContent = "✗ Server not running";
		startServerBtn.style.display = "inline";
	}
}

// Show instructions to start server
startServerBtn.addEventListener("click", () => {
	alert(`To start the server:
1. Open Command Prompt
2. Navigate to: C:\\Projects\\extension
3. Run: python server.py
4. Keep the window open
5. Refresh this popup`);
});

async function runTagui(steps, args = []) {
	out.textContent = "Running...";
	try {
		const res = await fetch("http://127.0.0.1:5000/run", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ steps, args }),
		});
		const data = await res.json();
		out.textContent = JSON.stringify(data, null, 2);
	} catch (e) {
		out.textContent =
			"Error: " + e.message + "\n\nMake sure server.py is running!";
	}
}

document.getElementById("run").addEventListener("click", async () => {
	let steps = stepsEl.value;
	const [tab] = await chrome.tabs.query({
		active: true,
		currentWindow: true,
	});
	if (tab && tab.url) {
		steps = steps.replaceAll("{{TAB_URL}}", tab.url);
	}
	const args = headlessEl.checked ? ["-edge", "-headless"] : ["-edge"];
	runTagui(steps, args);
});

// Check status when popup opens
checkServerStatus();
