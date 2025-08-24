// popup.js - Complete Native Chrome Extension Automation Assistant with Multi-Step Workflows
const GEMINI_API_KEY = "AIzaSyCX5MikS43fqeQjW6Y9U6UwF4pZZX48sw8";
const MODEL_ID = "models/gemini-2.5-flash";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

// Chat history to maintain conversation context
let chatHistory = [];

const els = {
	chat: document.getElementById("chat"),
	prompt: document.getElementById("prompt"),
	send: document.getElementById("send"),
	spinner: document.getElementById("spinner"),
};

// Available functions for Gemini to call
const AVAILABLE_FUNCTIONS = [
	{
		name: "execute_workflow",
		description:
			"Execute multiple automation steps sequentially (like commenting, reviewing, posting)",
		parameters: {
			type: "object",
			properties: {
				workflow_type: {
					type: "string",
					enum: [
						"youtube_comment",
						"amazon_review",
						"linkedin_post",
						"reddit_comment",
						"custom_workflow",
					],
					description: "Type of multi-step workflow to execute",
				},
				text_content: {
					type: "string",
					description: "Text to type/write in the workflow",
				},
				custom_steps: {
					type: "array",
					items: {
						type: "object",
						properties: {
							action: {
								type: "string",
								enum: ["click", "type", "wait"],
							},
							selector: { type: "string" },
							text: { type: "string" },
							delay: { type: "number" },
						},
					},
					description:
						"Custom sequence of steps for custom_workflow type",
				},
			},
			required: ["workflow_type", "text_content"],
		},
	},
	{
		name: "fill_form_current_page",
		description:
			"Fill forms directly in the currently active browser tab using real form field selectors",
		parameters: {
			type: "object",
			properties: {
				form_data: {
					type: "object",
					description:
						"Object mapping form field selectors/names to values (e.g., {'email': 'test@example.com', 'password': 'mypass'})",
				},
				submit_form: {
					type: "boolean",
					description: "Whether to submit the form after filling",
					default: false,
				},
			},
			required: ["form_data"],
		},
	},
	{
		name: "open_website_or_search",
		description:
			"Open websites, perform searches on Google/YouTube, or navigate to specific pages",
		parameters: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "URL to open or search query",
				},
				action_type: {
					type: "string",
					enum: [
						"direct_url",
						"google_search",
						"youtube_search",
						"youtube_play",
					],
					description: "Type of navigation action",
				},
				new_tab: {
					type: "boolean",
					description: "Open in new tab",
					default: true,
				},
			},
			required: ["query", "action_type"],
		},
	},
	{
		name: "click_element",
		description:
			"Click on any element in the current page (buttons, links, etc.)",
		parameters: {
			type: "object",
			properties: {
				selector: {
					type: "string",
					description:
						"CSS selector, text content, or element identifier to click",
				},
				wait_after: {
					type: "number",
					description: "Milliseconds to wait after clicking",
					default: 1000,
				},
			},
			required: ["selector"],
		},
	},
	{
		name: "type_text",
		description:
			"Type text into specific input fields or contenteditable elements (YouTube comments, LinkedIn posts, etc.)",
		parameters: {
			type: "object",
			properties: {
				selector: {
					type: "string",
					description:
						"CSS selector for the input field, or 'active' to use currently focused element",
				},
				text: {
					type: "string",
					description: "Text to type into the field",
				},
				clear_first: {
					type: "boolean",
					description: "Clear the field before typing",
					default: false,
				},
			},
			required: ["text"],
		},
	},
	{
		name: "type_into_active_element",
		description:
			"Type text into whatever element is currently focused/active (great for comment boxes)",
		parameters: {
			type: "object",
			properties: {
				text: {
					type: "string",
					description:
						"Text to type into the currently active element",
				},
			},
			required: ["text"],
		},
	},
];

// Page Content Extraction Functions
async function getCurrentPageContent() {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		if (!tab) return null;

		const results = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			function: extractPageContent,
		});

		return results?.[0]?.result || null;
	} catch (error) {
		console.error("Failed to get page content:", error);
		return null;
	}
}

// Content script function (runs in the page context)
function extractPageContent() {
	const content = {
		url: window.location.href,
		title: document.title,
		text: document.body.innerText.substring(0, 8000),
		html: document.documentElement.outerHTML.substring(0, 12000),
		forms: Array.from(document.querySelectorAll("form")).map((form) => ({
			id: form.id || null,
			action: form.action || null,
			method: form.method || "GET",
			inputs: Array.from(
				form.querySelectorAll("input, select, textarea")
			).map((input) => ({
				name: input.name || null,
				type: input.type || "text",
				id: input.id || null,
				placeholder: input.placeholder || null,
				value:
					input.type === "password"
						? "[PASSWORD]"
						: input.value || null,
			})),
		})),
		links: Array.from(document.querySelectorAll("a[href]"))
			.slice(0, 20)
			.map((a) => ({
				text: a.textContent.trim(),
				href: a.href,
			})),
		images: Array.from(document.querySelectorAll("img[src]"))
			.slice(0, 10)
			.map((img) => ({
				src: img.src,
				alt: img.alt || null,
			})),
		buttons: Array.from(
			document.querySelectorAll(
				'button, input[type="button"], input[type="submit"]'
			)
		)
			.slice(0, 15)
			.map((btn) => ({
				text: btn.textContent || btn.value || null,
				id: btn.id || null,
				type: btn.type || null,
			})),
		meta: {
			description:
				document.querySelector('meta[name="description"]')?.content ||
				null,
			keywords:
				document.querySelector('meta[name="keywords"]')?.content ||
				null,
			viewport:
				document.querySelector('meta[name="viewport"]')?.content ||
				null,
		},
	};

	return content;
}

// Multi-Step Workflow Execution
async function executeWorkflow(workflowType, textContent, customSteps) {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		// Define workflow templates
		const workflows = {
			youtube_comment: [
				{
					action: "click",
					selector: '#contenteditable-root, [contenteditable="true"]',
					description: "Click comment box",
					delay: 1000,
				},
				{
					action: "type",
					text: textContent,
					description: "Type comment text",
					delay: 500,
				},
				{
					action: "click",
					selector: '#submit-button, [aria-label*="Comment"]',
					description: "Click comment button",
					delay: 1000,
				},
			],
			amazon_review: [
				{
					action: "click",
					selector: '[data-hook="review-body"] textarea, #reviewText',
					description: "Click review text area",
					delay: 1000,
				},
				{
					action: "type",
					text: textContent,
					description: "Type review text",
					delay: 500,
				},
				{
					action: "click",
					selector:
						'[data-hook="ryp-review-submit-button"], .ryp-star-rating a',
					description: "Click rating stars first",
					delay: 1000,
				},
				{
					action: "click",
					selector:
						'button[type="submit"], [name="submit.add-to-cart"]',
					description: "Submit review",
					delay: 1000,
				},
			],
			linkedin_post: [
				{
					action: "click",
					selector: '[data-control-name="share-to-linkedin"]',
					description: "Click share box",
					delay: 1000,
				},
				{
					action: "type",
					text: textContent,
					description: "Type post content",
					delay: 500,
				},
				{
					action: "click",
					selector: '[data-control-name="share.post"]',
					description: "Click post button",
					delay: 1000,
				},
			],
			reddit_comment: [
				{
					action: "click",
					selector:
						'[data-testid="comment-submission-form-richtext"], .RichEditor-root',
					description: "Click comment box",
					delay: 1000,
				},
				{
					action: "type",
					text: textContent,
					description: "Type comment text",
					delay: 500,
				},
				{
					action: "click",
					selector:
						'button[type="submit"], [data-testid="comment-submission-form-submit-button"]',
					description: "Submit comment",
					delay: 1000,
				},
			],
			custom_workflow: customSteps || [],
		};

		const steps = workflows[workflowType];
		if (!steps || steps.length === 0) {
			return {
				success: false,
				error: `Unknown workflow type: ${workflowType}`,
			};
		}

		// Execute steps sequentially
		const results = [];

		for (let i = 0; i < steps.length; i++) {
			const step = steps[i];

			try {
				console.log(
					`Executing step ${i + 1}/${steps.length}: ${
						step.description
					}`
				);

				const stepResult = await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					function: (stepData) => {
						return new Promise((resolve) => {
							try {
								if (stepData.action === "click") {
									// Find and click element
									const selectors = stepData.selector
										.split(",")
										.map((s) => s.trim());
									let element = null;

									for (const sel of selectors) {
										element = document.querySelector(sel);
										if (element) break;
									}

									// Fallback: find by text content
									if (
										!element &&
										stepData.description.includes("comment")
									) {
										const buttons =
											document.querySelectorAll(
												'button, [role="button"]'
											);
										element = Array.from(buttons).find(
											(btn) =>
												btn.textContent
													.toLowerCase()
													.includes("comment") ||
												btn.textContent
													.toLowerCase()
													.includes("submit") ||
												btn
													.getAttribute("aria-label")
													?.toLowerCase()
													.includes("comment")
										);
									}

									if (element) {
										element.scrollIntoView({
											behavior: "smooth",
										});
										setTimeout(() => {
											element.click();
											resolve(
												`✅ Clicked: ${stepData.description}`
											);
										}, 500);
									} else {
										resolve(
											`❌ Element not found for: ${stepData.description}`
										);
									}
								} else if (stepData.action === "type") {
									// Type into active element or contenteditable
									const active = document.activeElement;

									if (active && active.isContentEditable) {
										active.focus();
										document.execCommand(
											"insertText",
											false,
											stepData.text
										);
										active.dispatchEvent(
											new Event("input", {
												bubbles: true,
											})
										);
										resolve(
											`✅ Typed into contenteditable: ${stepData.text}`
										);
									} else if (
										active &&
										(active.tagName === "INPUT" ||
											active.tagName === "TEXTAREA")
									) {
										active.focus();
										active.value = stepData.text;
										["input", "change"].forEach(
											(eventType) => {
												active.dispatchEvent(
													new Event(eventType, {
														bubbles: true,
													})
												);
											}
										);
										resolve(
											`✅ Typed into input: ${stepData.text}`
										);
									} else {
										// Try to find any text input
										const textInputs =
											document.querySelectorAll(
												'input[type="text"], textarea, [contenteditable="true"]'
											);
										const targetInput =
											textInputs[textInputs.length - 1]; // Usually the last one is the active one

										if (targetInput) {
											targetInput.focus();
											if (targetInput.isContentEditable) {
												document.execCommand(
													"insertText",
													false,
													stepData.text
												);
											} else {
												targetInput.value =
													stepData.text;
												targetInput.dispatchEvent(
													new Event("input", {
														bubbles: true,
													})
												);
											}
											resolve(
												`✅ Typed into found input: ${stepData.text}`
											);
										} else {
											resolve(
												`❌ No text input found for typing`
											);
										}
									}
								} else if (stepData.action === "wait") {
									setTimeout(() => {
										resolve(
											`✅ Waited ${stepData.delay}ms`
										);
									}, stepData.delay);
								}
							} catch (error) {
								resolve(`❌ Error: ${error.message}`);
							}
						});
					},
					args: [step],
				});

				const stepMessage = stepResult[0].result;
				results.push(`Step ${i + 1}: ${stepMessage}`);

				// Wait between steps
				await new Promise((resolve) =>
					setTimeout(resolve, step.delay || 1000)
				);
			} catch (error) {
				results.push(`Step ${i + 1}: ❌ Error - ${error.message}`);
			}
		}

		return {
			success: true,
			message: `Workflow "${workflowType}" completed`,
			details: {
				steps_executed: results.length,
				results: results,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: `Workflow execution failed: ${error.message}`,
		};
	}
}

// Enhanced Form Filling Function
async function fillFormCurrentPage(formData, submitForm) {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		const result = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			function: (data, shouldSubmit) => {
				console.log("Starting form fill with data:", data);

				function triggerReactEvents(element, value) {
					element.focus();
					element.value = value;

					const inputEvent = new Event("input", {
						bubbles: true,
						cancelable: true,
					});

					const changeEvent = new Event("change", {
						bubbles: true,
						cancelable: true,
					});

					const keydownEvent = new KeyboardEvent("keydown", {
						bubbles: true,
						cancelable: true,
					});

					const keyupEvent = new KeyboardEvent("keyup", {
						bubbles: true,
						cancelable: true,
					});

					element.dispatchEvent(keydownEvent);
					element.dispatchEvent(inputEvent);
					element.dispatchEvent(keyupEvent);
					element.dispatchEvent(changeEvent);

					setTimeout(() => element.blur(), 50);
				}

				function findElement(selector) {
					let elements = [];
					try {
						elements = document.querySelectorAll(selector);
						if (elements.length > 0) return elements[0];
					} catch (e) {}

					elements = document.querySelectorAll(
						`input[name="${selector}"], select[name="${selector}"], textarea[name="${selector}"]`
					);
					if (elements.length > 0) return elements[0];

					const byId = document.getElementById(selector);
					if (byId) return byId;

					elements = document.querySelectorAll(
						`input[placeholder*="${selector}"], textarea[placeholder*="${selector}"]`
					);
					if (elements.length > 0) return elements[0];

					elements = document.querySelectorAll(
						`[aria-label*="${selector}"]`
					);
					if (elements.length > 0) return elements[0];

					const labels = document.querySelectorAll("label");
					for (const label of labels) {
						if (
							label.textContent
								.toLowerCase()
								.includes(selector.toLowerCase())
						) {
							const forId = label.getAttribute("for");
							if (forId) {
								const input = document.getElementById(forId);
								if (input) return input;
							}
							const nestedInput = label.querySelector(
								"input, select, textarea"
							);
							if (nestedInput) return nestedInput;
						}
					}

					if (selector.toLowerCase().includes("email")) {
						const emailInputs = document.querySelectorAll(
							'input[type="email"], input[name*="email"], input[id*="email"]'
						);
						if (emailInputs.length > 0) return emailInputs[0];
					}

					if (selector.toLowerCase().includes("password")) {
						const passwordInputs = document.querySelectorAll(
							'input[type="password"], input[name*="password"], input[id*="password"]'
						);
						if (passwordInputs.length > 0) return passwordInputs[0];
					}

					return null;
				}

				let filled = 0;
				const results = [];

				Object.entries(data).forEach(([selector, value]) => {
					console.log(
						`Attempting to fill: ${selector} with value: ${value}`
					);

					const element = findElement(selector);

					if (!element) {
						console.log(`Element not found for: ${selector}`);
						results.push(`❌ ${selector}: Element not found`);
						return;
					}

					console.log(
						`Found element:`,
						element.tagName,
						element.type,
						element.name,
						element.id
					);

					try {
						if (element.type === "checkbox") {
							element.checked = Boolean(value);
							element.dispatchEvent(
								new Event("change", { bubbles: true })
							);
							filled++;
							results.push(
								`✅ ${selector}: Checkbox set to ${value}`
							);
						} else if (element.type === "radio") {
							if (element.value === value || value === true) {
								element.checked = true;
								element.dispatchEvent(
									new Event("change", { bubbles: true })
								);
								filled++;
								results.push(`✅ ${selector}: Radio selected`);
							}
						} else if (element.tagName === "SELECT") {
							element.value = value;
							element.dispatchEvent(
								new Event("change", { bubbles: true })
							);
							filled++;
							results.push(
								`✅ ${selector}: Select option set to ${value}`
							);
						} else {
							triggerReactEvents(element, value);
							filled++;
							results.push(
								`✅ ${selector}: Text filled with ${value}`
							);
						}

						console.log(`Successfully filled: ${selector}`);
					} catch (error) {
						console.error(`Error filling ${selector}:`, error);
						results.push(
							`❌ ${selector}: Error - ${error.message}`
						);
					}
				});

				if (shouldSubmit && filled > 0) {
					setTimeout(() => {
						const form = document.querySelector("form");
						if (form) {
							console.log("Submitting form...");
							form.submit();
							results.push("✅ Form submitted");
						} else {
							results.push("❌ No form found to submit");
						}
					}, 500);
				}

				return {
					filled: filled,
					total: Object.keys(data).length,
					results: results,
					summary: `Filled ${filled}/${
						Object.keys(data).length
					} fields`,
				};
			},
			args: [formData, submitForm],
		});

		return {
			success: true,
			message: result[0].result.summary,
			details: result[0].result,
		};
	} catch (error) {
		console.error("Form filling error:", error);
		return {
			success: false,
			error: `Form filling failed: ${error.message}`,
		};
	}
}

async function openWebsiteOrSearch(query, actionType, newTab) {
	try {
		let finalUrl = query;

		switch (actionType) {
			case "google_search":
				finalUrl = `https://www.google.com/search?q=${encodeURIComponent(
					query
				)}`;
				break;
			case "youtube_search":
				finalUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
					query
				)}`;
				break;
			case "youtube_play":
				finalUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(
					query
				)}`;
				setTimeout(async () => {
					const [tab] = await chrome.tabs.query({
						active: true,
						currentWindow: true,
					});
					chrome.scripting.executeScript({
						target: { tabId: tab.id },
						function: () => {
							const firstVideo =
								document.querySelector("a#video-title");
							if (firstVideo) firstVideo.click();
						},
					});
				}, 2000);
				break;
			case "direct_url":
				if (!query.startsWith("http")) {
					finalUrl = "https://" + query;
				}
				break;
		}

		if (newTab) {
			await chrome.tabs.create({ url: finalUrl });
		} else {
			const [tab] = await chrome.tabs.query({
				active: true,
				currentWindow: true,
			});
			await chrome.tabs.update(tab.id, { url: finalUrl });
		}

		return {
			success: true,
			message: `Opened: ${finalUrl}`,
		};
	} catch (error) {
		return {
			success: false,
			error: `Navigation failed: ${error.message}`,
		};
	}
}

async function clickElement(selector, waitAfter) {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		const result = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			function: (sel, wait) => {
				let element =
					document.querySelector(sel) ||
					document.querySelector(`[id="${sel}"]`) ||
					document.querySelector(`[aria-label="${sel}"]`) ||
					Array.from(
						document.querySelectorAll('button, a, [role="button"]')
					).find((el) =>
						el.textContent
							.trim()
							.toLowerCase()
							.includes(sel.toLowerCase())
					);

				if (element) {
					element.click();
					if (wait > 0) {
						return new Promise((resolve) =>
							setTimeout(
								() => resolve(`Clicked element: ${sel}`),
								wait
							)
						);
					}
					return `Clicked element: ${sel}`;
				} else {
					throw new Error(`Element not found: ${sel}`);
				}
			},
			args: [selector, waitAfter || 0],
		});

		return {
			success: true,
			message: result[0].result,
		};
	} catch (error) {
		return {
			success: false,
			error: `Click failed: ${error.message}`,
		};
	}
}

async function typeText(selector, text, clearFirst) {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		const result = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			function: (sel, txt, clear) => {
				console.log(`Attempting to type: "${txt}" into: ${sel}`);

				function typeIntoContentEditable(element, text) {
					element.focus();

					if (clear) {
						element.innerHTML = "";
					}

					document.execCommand("insertText", false, text);

					element.dispatchEvent(
						new Event("input", { bubbles: true })
					);
					element.dispatchEvent(
						new Event("change", { bubbles: true })
					);

					return `Inserted "${text}" into contenteditable element`;
				}

				function typeIntoInput(element, text) {
					element.focus();

					if (clear) {
						element.value = "";
					}

					element.value += text;

					["input", "change", "blur", "keydown", "keyup"].forEach(
						(eventType) => {
							element.dispatchEvent(
								new Event(eventType, { bubbles: true })
							);
						}
					);

					return `Typed "${text}" into input element`;
				}

				let element = document.querySelector(sel);

				if (!element) {
					element = document.querySelector(`[name="${sel}"]`);
				}

				if (!element) {
					element = document.getElementById(sel);
				}

				if (!element) {
					element = document.querySelector(`[placeholder*="${sel}"]`);
				}

				if (!element) {
					element = document.activeElement;
					if (!element || element.tagName === "BODY") {
						return `❌ No element found for selector: ${sel} and no active element`;
					}
				}

				console.log(
					"Found element:",
					element.tagName,
					element.type,
					element.isContentEditable
				);

				try {
					if (element.isContentEditable) {
						return typeIntoContentEditable(element, txt);
					} else if (
						element.tagName === "INPUT" ||
						element.tagName === "TEXTAREA"
					) {
						return typeIntoInput(element, txt);
					} else if (element.tagName === "IFRAME") {
						try {
							const iframeDoc =
								element.contentDocument ||
								element.contentWindow.document;
							const body = iframeDoc.body;
							if (body && body.isContentEditable) {
								return typeIntoContentEditable(body, txt);
							}
						} catch (e) {
							return `❌ Cannot access iframe content: ${e.message}`;
						}
					} else {
						return `❌ Element is not an input, textarea, or contenteditable: ${element.tagName}`;
					}
				} catch (error) {
					return `❌ Error typing into element: ${error.message}`;
				}
			},
			args: [selector, text, clearFirst],
		});

		return {
			success: true,
			message: result[0].result,
		};
	} catch (error) {
		return {
			success: false,
			error: `Type text failed: ${error.message}`,
		};
	}
}

async function typeIntoActiveElement(text) {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});

		const result = await chrome.scripting.executeScript({
			target: { tabId: tab.id },
			function: (txt) => {
				const active = document.activeElement;

				if (!active || active.tagName === "BODY") {
					return `❌ No active element to type into. Click on a text field first.`;
				}

				console.log(
					"Active element:",
					active.tagName,
					active.type,
					active.isContentEditable
				);

				if (active.isContentEditable) {
					active.focus();
					document.execCommand("insertText", false, txt);
					active.dispatchEvent(new Event("input", { bubbles: true }));
					return `✅ Typed "${txt}" into contenteditable element`;
				} else if (
					active.tagName === "INPUT" ||
					active.tagName === "TEXTAREA"
				) {
					active.focus();
					active.value += txt;
					["input", "change"].forEach((eventType) => {
						active.dispatchEvent(
							new Event(eventType, { bubbles: true })
						);
					});
					return `✅ Typed "${txt}" into input field`;
				} else {
					return `❌ Active element (${active.tagName}) is not a text input`;
				}
			},
			args: [text],
		});

		return {
			success: true,
			message: result[0].result,
		};
	} catch (error) {
		return {
			success: false,
			error: `Failed to type into active element: ${error.message}`,
		};
	}
}

// Execute Function Calls
async function executeFunctionCall(functionCall) {
	const { name, args } = functionCall;

	switch (name) {
		case "execute_workflow":
			return await executeWorkflow(
				args.workflow_type,
				args.text_content,
				args.custom_steps
			);

		case "fill_form_current_page":
			return await fillFormCurrentPage(args.form_data, args.submit_form);

		case "open_website_or_search":
			return await openWebsiteOrSearch(
				args.query,
				args.action_type,
				args.new_tab
			);

		case "click_element":
			return await clickElement(args.selector, args.wait_after);

		case "type_text":
			return await typeText(args.selector, args.text, args.clear_first);

		case "type_into_active_element":
			return await typeIntoActiveElement(args.text);

		default:
			return { success: false, error: `Unknown function: ${name}` };
	}
}

// UI Functions
function addMessage(role, text, isCode = false) {
	const wrap = document.createElement("div");
	wrap.className = `msg ${role}`;
	const bubble = document.createElement("div");
	bubble.className = "bubble";

	if (isCode) {
		bubble.innerHTML = `<pre><code>${text}</code></pre>`;
	} else {
		bubble.textContent = text;
	}

	wrap.appendChild(bubble);
	els.chat.appendChild(wrap);
	els.chat.scrollTop = els.chat.scrollHeight;

	if (role === "user" || role === "bot") {
		chatHistory.push({
			role: role === "user" ? "user" : "model",
			parts: [{ text: text }],
		});
	}
}

function setLoading(isLoading) {
	els.spinner.style.display = isLoading ? "block" : "none";
	els.send.disabled = isLoading;
	els.prompt.disabled = isLoading;
}

// Enhanced Chat Payload with COMPLETE Page Content
async function buildChatPayloadWithPage(userText) {
	const pageContent = await getCurrentPageContent();

	let enhancedUserText = userText;

	if (pageContent) {
		enhancedUserText += `

[COMPLETE CURRENT PAGE CONTEXT]
URL: ${pageContent.url}
Title: ${pageContent.title}

=== PAGE TEXT CONTENT ===
${pageContent.text}

=== HTML STRUCTURE ===
${pageContent.html}

=== FORMS ON PAGE ===
${JSON.stringify(pageContent.forms, null, 2)}

=== BUTTONS ON PAGE ===
${JSON.stringify(pageContent.buttons, null, 2)}

=== LINKS ON PAGE ===
${JSON.stringify(pageContent.links, null, 2)}

=== IMAGES ON PAGE ===
${JSON.stringify(pageContent.images, null, 2)}

=== PAGE METADATA ===
${JSON.stringify(pageContent.meta, null, 2)}

[END PAGE CONTEXT]
`;
	}

	return {
		contents: [
			...chatHistory,
			{
				role: "user",
				parts: [{ text: enhancedUserText }],
			},
		],
		tools: [
			{
				function_declarations: AVAILABLE_FUNCTIONS,
			},
		],
		systemInstruction: {
			parts: [
				{
					text: `You are an intelligent Chrome extension automation assistant with COMPLETE access to the current webpage content and multi-step workflow capabilities.

CAPABILITIES:
1. **Multi-Step Workflows** - Execute complete sequences like commenting, reviewing, posting:
   - youtube_comment: Click comment box → Type text → Submit comment
   - amazon_review: Click review area → Type review → Submit rating
   - linkedin_post: Click share box → Type content → Post
   - reddit_comment: Click comment box → Type text → Submit
   - custom_workflow: Execute custom sequence of steps

2. **Form Filling** - Fill any form using real field selectors and names
3. **Element Clicking** - Click buttons, links, or any clickable elements  
4. **Text Input** - Type into any input fields or contenteditable elements
5. **Page Navigation** - Open websites, search Google/YouTube
6. **Complete Page Context** - Full access to page HTML, forms, buttons, content

AUTOMATION APPROACH:
- For multi-step actions (comment, review, post), use execute_workflow
- Use single functions (click_element, type_text) for individual actions  
- Parse complex commands into appropriate workflows
- Use actual element selectors from the page content provided
- Work with the user's current browser session and login state

BEHAVIOR:
- When users want to perform multi-step actions, automatically choose the right workflow
- Execute steps sequentially with proper timing
- Use actual element names, IDs, and selectors from the page
- Remember conversation history and page context
- Provide clear feedback on what steps are being executed

EXAMPLES:
- "Write a comment saying I like this video" → youtube_comment workflow
- "Post a review saying great product" → amazon_review workflow  
- "Comment on this Reddit post" → reddit_comment workflow
- "Fill this login form" → Use form filling for individual action
- "Click submit button" → Use click_element for single action

You have complete native browser automation with sequential workflow capabilities.`,
				},
			],
		},
	};
}

// Gemini Chat API Integration
async function callGeminiChat(userText) {
	if (!GEMINI_API_KEY) {
		throw new Error("Gemini API key missing");
	}

	const url = `${BASE_URL}/${MODEL_ID}:generateContent?key=${encodeURIComponent(
		GEMINI_API_KEY
	)}`;
	const payload = await buildChatPayloadWithPage(userText);

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(
			`Gemini API Error ${res.status}: ${text || res.statusText}`
		);
	}

	const json = await res.json();
	const candidate = json?.candidates?.[0];

	const functionCalls =
		candidate?.content?.parts?.filter((part) => part.functionCall) || [];
	const textParts =
		candidate?.content?.parts?.filter((part) => part.text) || [];

	let responseText = textParts
		.map((p) => p.text)
		.join("\n")
		.trim();

	if (functionCalls.length > 0) {
		for (const part of functionCalls) {
			const functionCall = part.functionCall;
			addMessage("system", `🔧 Executing: ${functionCall.name}`, true);

			const result = await executeFunctionCall({
				name: functionCall.name,
				args: functionCall.args,
			});

			if (result.success) {
				const message =
					result.message ||
					result.output ||
					"✅ Function executed successfully";
				addMessage("system", message);

				if (result.details) {
					addMessage(
						"system",
						`📋 Details:\n${JSON.stringify(
							result.details,
							null,
							2
						)}`,
						true
					);
				}
			} else {
				addMessage("system", `❌ Error: ${result.error}`);
			}
		}
	}

	return (
		responseText ||
		(functionCalls.length > 0 ? "Actions completed!" : "I'm ready to help!")
	);
}

// Clear chat history function
function clearChat() {
	chatHistory = [];
	els.chat.innerHTML = "";
	addMessage(
		"bot",
		`🤖 **Multi-Step Automation Assistant Ready!**

I can help you with:
• **Sequential Workflows**: "Write a comment saying I like this video" 
• **Form Filling**: "Fill this login form with my details"
• **Element Actions**: "Click the submit button"  
• **Text Input**: "Type a comment on this video"
• **Navigation**: "Open YouTube and search for music"

I execute multiple steps in the correct order automatically!`
	);
}

// Event Handlers
async function sendMessage() {
	const prompt = els.prompt.value.trim();
	if (!prompt) return;

	addMessage("user", prompt);
	els.prompt.value = "";
	setLoading(true);

	try {
		const reply = await callGeminiChat(prompt);
		if (reply.trim()) {
			addMessage("bot", reply);
		}
	} catch (err) {
		console.error(err);
		addMessage("bot", "❌ Error: " + (err?.message || "Request failed"));
	} finally {
		setLoading(false);
	}
}

els.send.addEventListener("click", sendMessage);
els.prompt.addEventListener("keydown", (e) => {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
});

// Initialize
addMessage(
	"bot",
	`🤖 **Multi-Step Automation Assistant Ready!**

I can automate complex workflows with sequential steps:
• **YouTube Comments**: "Write a comment saying I love this video"
• **Amazon Reviews**: "Post a review saying great product" 
• **LinkedIn Posts**: "Create a post about my day"
• **Reddit Comments**: "Comment on this thread"
• **Form Filling**: Fill login forms, contact forms, surveys
• **Element Actions**: Click buttons, type text, navigate pages

Just describe what you want to do in natural language!

**Example commands:**
- "Write a YouTube comment saying this is amazing"
- "Post an Amazon review saying excellent quality"
- "Fill this form with test data"
- "Click the login button and then type my email"`
);
