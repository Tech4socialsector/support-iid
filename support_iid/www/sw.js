// Support IID service worker — minimal by design. Its only job is to
// satisfy the browser's installability requirement (Chrome/Edge/mobile
// require a registered service worker with a fetch handler before they'll
// offer Add to Home Screen / Install), not to run a full offline app.
//
// Deliberately does NOT cache or intercept anything: this app is a Frappe
// Desk client with live data (case approvals, dashboards) and its own
// realtime websocket connection — caching API responses or navigation
// requests here risks serving stale case data or breaking socket.io's
// upgrade handshake. A pass-through fetch handler is enough to qualify as
// installable while guaranteeing every request still goes to the network.

const SW_VERSION = "support-iid-sw-v1";

self.addEventListener("install", (event) => {
	self.skipWaiting();
});

self.addEventListener("activate", (event) => {
	event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
	// No-op: let every request pass straight through to the network.
	// Present only so the browser recognizes this as a valid, controlling
	// service worker for installability purposes.
});
