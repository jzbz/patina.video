/* patina.video
 *
 * Two jobs on every page: remember a light/dark choice, and copy the commands.
 * The window rebuilt on the front page has a file of its own, player.js.
 *
 * Nothing here is required to read the page.
 */
(function () {
    "use strict";

    var root = document.documentElement;

    /* ------------------------------------------------------------ theme */

    var stored = null;

    try {
        stored = localStorage.getItem("patina-theme");
    } catch (e) {
        /* Private mode, or storage disabled. The dark default stands. */
    }

    /* Reflect the theme on the control without claiming one, so the button is
       right even before anybody has chosen. */
    function syncButton(theme) {
        var button = document.getElementById("theme-toggle");
        if (!button) { return; }
        button.setAttribute("aria-pressed", String(theme === "dark"));
        button.setAttribute("aria-label", "Dark theme");
    }

    function current() {
        return root.classList.contains("light") ? "light" : "dark";
    }

    if (stored === "light") { root.classList.add("light"); }
    syncButton(current());

    /* The browser's own chrome above the page is painted from this meta tag
       and does not follow a custom property, so it is set from the palette
       rather than written twice. */
    function paintChrome() {
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) { return; }
        meta.setAttribute("content",
            getComputedStyle(root).getPropertyValue("--bg").trim());
    }

    paintChrome();

    var toggle = document.getElementById("theme-toggle");
    if (toggle) {
        toggle.hidden = false;
        toggle.addEventListener("click", function () {
            var next = current() === "dark" ? "light" : "dark";

            /* Transitions off across the switch, and a forced reflow in the
               middle of it: a declared transition stops the property being
               recomputed when only a custom property underneath it changed,
               and a theme change is one decision anyway, not three hundred
               elements crossing over at their own pace. */
            root.classList.add("theming");
            root.classList.toggle("light", next === "light");
            void root.offsetHeight;
            root.classList.remove("theming");

            syncButton(next);
            paintChrome();

            try {
                localStorage.setItem("patina-theme", next);
            } catch (e) {
                /* The choice holds for this page view and no longer. */
            }
        });
    }

    /* ------------------------------------------------------ page chrome */

    var head = document.getElementById("siteHead");
    if (head) {
        var onScroll = function () {
            head.classList.toggle("is-stuck", window.scrollY > 8);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
    }

    /* -------------------------------------------------------- the copy */

    var status = document.getElementById("copy-status");

    function announce(message) {
        if (status) { status.textContent = message; }
    }

    Array.prototype.forEach.call(document.querySelectorAll(".cmd"), function (block) {
        var button = block.querySelector(".copy");
        if (!button) { return; }

        /* The clipboard API is missing on any origin that is not secure. A
           button that is focusable, announced and inert is worse than no
           button, so it goes rather than staying as decoration. */
        if (!navigator.clipboard) { button.remove(); return; }

        var settle = null;

        button.addEventListener("click", function () {
            navigator.clipboard.writeText(block.dataset.copy || "").then(function () {
                block.classList.add("is-copied");
                announce("Copied to the clipboard.");
                /* Held, so a second press restarts the mark rather than
                   having the first press's timer clear the second's. */
                window.clearTimeout(settle);
                settle = window.setTimeout(function () {
                    block.classList.remove("is-copied");
                }, 1200);
            }, function () {
                announce("Could not copy. Select the command and copy it by hand.");
            });
        });
    });

}());
