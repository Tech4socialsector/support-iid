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
			});
		});
	}
})();
