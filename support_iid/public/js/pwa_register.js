// Makes the Desk installable as a PWA (Chrome/Edge "Install app", mobile
// "Add to Home Screen") — loaded on every Desk page via app_include_js.
// Two things are required for a browser to offer that prompt: a
// <link rel="manifest"> in <head> (injected below, since desk.html itself
// is core Frappe and can't be edited without losing the change on the
// next framework update) and a registered, controlling service worker
// (see /sw.js — deliberately a pass-through no-op, not an offline cache;
// see its own comment for why).
(function () {
	if (!document.querySelector('link[rel="manifest"]')) {
		var link = document.createElement("link");
		link.rel = "manifest";
		link.href = "/manifest.json";
		document.head.appendChild(link);
	}

	if ("serviceWorker" in navigator) {
		window.addEventListener("load", function () {
			navigator.serviceWorker.register("/sw.js").catch(function () {
				// Installability just won't be offered — never block the
				// Desk from loading over this.
			});
		});
	}
})();
