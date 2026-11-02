/* patina.video
 *
 * The window on the front page, working. It behaves as ui/controls.slint,
 * ui/sidebar.slint and src/window.rs say the app does: the same speed ladder
 * on the arrow buttons, the same words on screen, the controls gone after
 * 2.5 seconds, a click to show or hide them, a double click for full screen.
 *
 * There are no video files. Each "file" in the playlist is a function from a
 * time to a picture, which is why seeking is real and why the seek bar's
 * previews are the actual frames: they come out of the same code, into a
 * smaller canvas. The names are the test patterns in the app's own
 * screenshots. The page is silent, so the volume and the equalizer move and
 * change nothing, and the Audio panel says as much.
 *
 * Without this file the window is a still picture with its controls drawn on.
 * With it, it plays only while it is on screen, and it starts paused for anyone
 * who has asked for less motion.
 */
(function () {
    "use strict";

    var reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    /* --------------------------------------------------------- helpers */

    function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }

    function smooth(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }

    /* mulberry32. Seeking back has to give the same picture again, so nothing
       here touches Math.random. */
    function random(seed) {
        return function () {
            seed = (seed + 0x6D2B79F5) | 0;
            var x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
            return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
        };
    }

    function clock(value) {
        var total = Math.max(0, Math.floor(value));
        var h = Math.floor(total / 3600);
        var m = Math.floor(total / 60) % 60;
        var s = total % 60;
        return (h ? (h < 10 ? "0" : "") + h + ":" : "") +
            (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
    }

    function timecode(t) {
        var frames = Math.floor((t % 1) * 24);
        return clock(t) + ":" + (frames < 10 ? "0" : "") + frames;
    }

    function speedText(value) {
        return String(parseFloat(value.toFixed(2))) + "×";
    }

    function hex(colour) {
        return [parseInt(colour.slice(1, 3), 16), parseInt(colour.slice(3, 5), 16),
            parseInt(colour.slice(5, 7), 16)];
    }

    /* A little-endian 32-bit pixel, which is every machine this page will
       meet. */
    function pixel(rgb) {
        return (255 << 24 | rgb[2] << 16 | rgb[1] << 8 | rgb[0]) >>> 0;
    }

    /* ---------------------------------------------------- the "videos"
     *
     * Each factory returns draw(context, width, height, time), and is called
     * once per canvas, because the simulations keep their own place.
     */

    function bars() {
        var top = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"];
        var mid = ["#0000c0", "#101010", "#c000c0", "#101010", "#00c0c0", "#101010", "#c0c0c0"];
        var low = ["#00214c", "#ffffff", "#32006a", "#131313", "#090909", "#131313", "#1d1d1d", "#131313"];
        var edges = [0, 1.25, 2.5, 3.75, 5.25, 5.75, 6.25, 7];

        return function (c, w, h, t) {
            var i, bw = w / 7;
            for (i = 0; i < 7; i += 1) {
                c.fillStyle = top[i];
                c.fillRect(i * bw, 0, bw + 1, h * 0.67);
                c.fillStyle = mid[i];
                c.fillRect(i * bw, h * 0.67, bw + 1, h * 0.08);
            }
            for (i = 0; i < 7; i += 1) {
                c.fillStyle = low[i];
                c.fillRect(edges[i] * bw, h * 0.75, (edges[i + 1] - edges[i]) * bw + 1, h * 0.25);
            }
            /* The tone, as a line across the bars. */
            c.fillStyle = "#ffffff";
            c.fillRect((t * 0.08 % 1) * w, h * 0.67, Math.max(1, w / 320), h * 0.08);
            c.fillStyle = "#000000b0";
            c.fillRect(w * 0.36, h * 0.82, w * 0.28, h * 0.11);
            c.fillStyle = "#ffffff";
            c.font = "600 " + Math.round(h * 0.06) + "px 'IBM Plex Sans', sans-serif";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText(timecode(t), w / 2, h * 0.877);
        };
    }

    function spectrum() {
        return function (c, w, h, t) {
            var i, g = c.createLinearGradient(0, 0, w, 0);
            for (i = 0; i <= 12; i += 1) {
                g.addColorStop(i / 12, "hsl(" + ((i * 30 + t * 12) % 360) + " 90% 50%)");
            }
            c.fillStyle = g;
            c.fillRect(0, 0, w, h);
            g = c.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, "#ffffffd0");
            g.addColorStop(0.45, "#ffffff00");
            g.addColorStop(0.55, "#00000000");
            g.addColorStop(1, "#000000e0");
            c.fillStyle = g;
            c.fillRect(0, 0, w, h);
        };
    }

    /* Conway's rules on a torus, in the colours of the screenshot: living cells
       in pale verdigris, and the dead ones cooling through copper. A fresh soup
       every forty seconds, since on a board this size one burns down to still
       lifes before long. */
    function life() {
        var COLS = 64, ROWS = 36, GENS = 8, SOUP = 40;
        var cells = new Uint8Array(COLS * ROWS);
        var next = new Uint8Array(COLS * ROWS);
        var heat = new Uint8Array(COLS * ROWS);
        var ramp = ["#000000", "#1c0e07", "#35190b", "#512611", "#6f3417", "#8c431d", "#a85224"];
        var soup = -1, generation = 0;

        function seed(n) {
            var r = random(n * 7919 + 13), i;
            for (i = 0; i < cells.length; i += 1) {
                cells[i] = r() < 0.31 ? 1 : 0;
                heat[i] = 0;
            }
            generation = 0;
        }

        function step() {
            var x, y, l, r, u, d, n, at;
            for (y = 0; y < ROWS; y += 1) {
                u = (y + ROWS - 1) % ROWS;
                d = (y + 1) % ROWS;
                for (x = 0; x < COLS; x += 1) {
                    l = (x + COLS - 1) % COLS;
                    r = (x + 1) % COLS;
                    at = y * COLS + x;
                    n = cells[u * COLS + l] + cells[u * COLS + x] + cells[u * COLS + r] +
                        cells[y * COLS + l] + cells[y * COLS + r] +
                        cells[d * COLS + l] + cells[d * COLS + x] + cells[d * COLS + r];
                    next[at] = n === 3 || (n === 2 && cells[at]) ? 1 : 0;
                    if (cells[at] && !next[at]) { heat[at] = ramp.length - 1; }
                    else if (heat[at]) { heat[at] -= 1; }
                }
            }
            var swap = cells;
            cells = next;
            next = swap;
            generation += 1;
        }

        return function (c, w, h, t) {
            var wanted = Math.floor(t / SOUP);
            var target = Math.floor((t % SOUP) * GENS);
            if (wanted !== soup || target < generation) {
                soup = wanted;
                seed(soup);
            }
            while (generation < target) { step(); }

            c.fillStyle = "#000";
            c.fillRect(0, 0, w, h);
            var cw = w / COLS, ch = h / ROWS, x, y, at;
            for (y = 0; y < ROWS; y += 1) {
                for (x = 0; x < COLS; x += 1) {
                    at = y * COLS + x;
                    if (cells[at]) { c.fillStyle = "#7fe3c4"; }
                    else if (heat[at]) { c.fillStyle = ramp[heat[at]]; }
                    else { continue; }
                    c.fillRect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw), Math.ceil(ch));
                }
            }
        };
    }

    function drift() {
        var blobs = [
            ["#2aa889", 0.31, 0.0, 0.23, 1.2, 0.62],
            ["#b96a35", 0.19, 2.1, 0.29, 4.0, 0.5],
            ["#7fd1b9", 0.13, 4.4, 0.17, 2.6, 0.42],
            ["#1f5f8a", 0.23, 5.5, 0.11, 0.3, 0.58]
        ];

        return function (c, w, h, t) {
            c.globalCompositeOperation = "source-over";
            c.fillStyle = "#07100f";
            c.fillRect(0, 0, w, h);
            c.globalCompositeOperation = "lighter";
            blobs.forEach(function (b) {
                var x = (0.5 + 0.42 * Math.sin(t * b[1] * 0.2 + b[2])) * w;
                var y = (0.5 + 0.42 * Math.cos(t * b[3] * 0.2 + b[4])) * h;
                var r = b[5] * w;
                var g = c.createRadialGradient(x, y, 0, x, y, r);
                g.addColorStop(0, b[0]);
                g.addColorStop(1, b[0] + "00");
                c.fillStyle = g;
                c.fillRect(0, 0, w, h);
            });
            c.globalCompositeOperation = "source-over";
        };
    }

    /* The picture from the app's screenshot, and a real visit: a chapter holds
       each place, closing slowly, and the last fourteen seconds of one back out
       and travel to the next. The set is computed only when the view has moved
       by about half a pixel of the buffer; between those, only the palette
       turns, which costs a table lookup per pixel. That is what keeps this
       cheap enough to leave running on a page. */
    function mandelbrot(chapters) {
        var places = [
            { x: -0.72, y: 0, s: 1.22 },
            { x: -0.7453, y: 0.1127, s: 0.03 },
            { x: 0.2925, y: 0.0155, s: 0.012 },
            { x: -1.7549, y: 0, s: 0.03 }
        ];
        var stops = ["#0b2f29", "#10493e", "#1b6a58", "#1f7a68", "#17604f", "#0d3a32", "#0b2f29", "#2aa889", "#efe4b0", "#a85f30", "#3a2114", "#0b2f29"];
        var lut = new Uint32Array(1024);
        var i, j, u, a, b;
        for (i = 0; i < lut.length; i += 1) {
            u = i / lut.length * (stops.length - 1);
            j = Math.floor(u);
            u -= j;
            a = hex(stops[j]);
            b = hex(stops[j + 1]);
            lut[i] = pixel([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
        }
        var inside = pixel(hex("#efe4b0"));

        var off = null, octx, image, words, values, last = null, bw, bh;

        function view(t, duration) {
            var at = 0, n;
            for (n = 0; n < chapters.length; n += 1) {
                if (t >= chapters[n][0]) { at = n; }
            }
            var start = chapters[at][0];
            var end = at + 1 < chapters.length ? chapters[at + 1][0] : duration;
            var from = places[at];
            var held = t - start;
            var leave = end - start - 14;
            var closing = Math.exp(-0.006 * held);
            if (at + 1 >= chapters.length || held < leave) {
                return { x: from.x, y: from.y, s: from.s * closing };
            }
            var to = places[at + 1];
            var k = smooth((held - leave) / 14);
            var la = Math.log(from.s * closing), lb = Math.log(to.s);
            /* Out to where both places are in view, across, then in. Crossing
               at the closer zoom would mean flying through the inside of the
               set, which is one flat colour. */
            var ls = la + (lb - la) * k +
                (Math.log(1.3) - (la + lb) / 2) * Math.pow(Math.sin(Math.PI * k), 0.6);
            var m = smooth((k - 0.3) / 0.4);
            return {
                x: from.x + (to.x - from.x) * m,
                y: from.y + (to.y - from.y) * m,
                s: Math.exp(ls)
            };
        }

        function compute(v) {
            var dy = 2 * v.s / bh, dx = dy;
            var x0 = v.x - dx * bw / 2, y0 = v.y - dy * bh / 2;
            var limit = Math.min(260, 60 + Math.round(36 * Math.log2(1.25 / v.s)));
            var px, py, cx, cy, cy2, q, zx, zy, x2, y2, n, at = 0;
            for (py = 0; py < bh; py += 1) {
                cy = y0 + py * dy;
                cy2 = cy * cy;
                for (px = 0; px < bw; px += 1) {
                    cx = x0 + px * dx;
                    /* The main cardioid and the period-two bulb, in closed form:
                       they are most of the picture, and otherwise the slowest. */
                    q = (cx - 0.25) * (cx - 0.25) + cy2;
                    if (q * (q + cx - 0.25) <= 0.25 * cy2 || (cx + 1) * (cx + 1) + cy2 <= 0.0625) {
                        values[at] = -1;
                        at += 1;
                        continue;
                    }
                    zx = 0; zy = 0; x2 = 0; y2 = 0; n = 0;
                    while (x2 + y2 <= 256 && n < limit) {
                        zy = 2 * zx * zy + cy;
                        zx = x2 - y2 + cx;
                        x2 = zx * zx;
                        y2 = zy * zy;
                        n += 1;
                    }
                    values[at] = n === limit ? -1 : n + 1 - Math.log2(Math.log2(x2 + y2) / 2);
                    at += 1;
                }
            }
        }

        return function (c, w, h, t, duration) {
            if (!off) {
                bw = w > 400 ? 640 : w;
                bh = Math.round(bw * 9 / 16);
                off = document.createElement("canvas");
                off.width = bw;
                off.height = bh;
                octx = off.getContext("2d");
                image = octx.createImageData(bw, bh);
                words = new Uint32Array(image.data.buffer);
                values = new Float32Array(bw * bh);
            }
            var v = view(t, duration || 365);
            var tolerance = v.s / bh;
            if (!last || Math.abs(v.s - last.s) > tolerance ||
                    Math.abs(v.x - last.x) > tolerance || Math.abs(v.y - last.y) > tolerance) {
                compute(v);
                last = v;
            }
            var phase = t * 14, size = lut.length, n, value;
            for (n = 0; n < values.length; n += 1) {
                value = values[n];
                words[n] = value < 0 ? inside
                    : lut[Math.floor(Math.log(value + 1) * 120 + phase) % size];
            }
            octx.putImageData(image, 0, 0);
            c.imageSmoothingEnabled = true;
            c.imageSmoothingQuality = "high";
            c.drawImage(off, 0, 0, w, h);
        };
    }

    /* A one-dimensional automaton, Turing-complete and scrolling up the screen. */
    function rule110() {
        var COLS = 256, ROWS = 144, GENS = 16;
        var rows = new Uint8Array(COLS * ROWS);
        var off = null, octx, image, words, head = 0, generation = -1;
        var live = [], dead = pixel(hex("#0a1312")), a = hex("#6cc4ac"), b = hex("#c98a55"), i, u;
        for (i = 0; i < ROWS; i += 1) {
            u = i / (ROWS - 1);
            live.push(pixel([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]));
        }

        function start() {
            var r = random(110), x;
            rows.fill(0);
            for (x = 0; x < COLS; x += 1) { rows[x] = r() < 0.5 ? 1 : 0; }
            head = 0;
            generation = 0;
        }

        function step() {
            var from = head * COLS;
            head = (head + 1) % ROWS;
            var to = head * COLS, x, l, m, r;
            for (x = 0; x < COLS; x += 1) {
                l = rows[from + (x + COLS - 1) % COLS];
                m = rows[from + x];
                r = rows[from + (x + 1) % COLS];
                rows[to + x] = (110 >> (l << 2 | m << 1 | r)) & 1;
            }
            generation += 1;
        }

        return function (c, w, h, t) {
            if (!off) {
                off = document.createElement("canvas");
                off.width = COLS;
                off.height = ROWS;
                octx = off.getContext("2d");
                image = octx.createImageData(COLS, ROWS);
                words = new Uint32Array(image.data.buffer);
            }
            var target = Math.floor(t * GENS);
            if (target < generation || generation < 0) { start(); }
            while (generation < target) { step(); }

            var y, x, src;
            for (y = 0; y < ROWS; y += 1) {
                src = ((head - (ROWS - 1 - y) + ROWS) % ROWS) * COLS;
                for (x = 0; x < COLS; x += 1) {
                    words[y * COLS + x] = rows[src + x] ? live[y] : dead;
                }
            }
            octx.putImageData(image, 0, 0);
            c.imageSmoothingEnabled = false;
            c.drawImage(off, 0, 0, w, h);
            c.imageSmoothingEnabled = true;
        };
    }

    function card() {
        return function (c, w, h, t) {
            var cell = w / 16, x, y, r = h * 0.42, cx = w / 2, cy = h / 2;
            c.fillStyle = "#5f6264";
            c.fillRect(0, 0, w, h);
            c.strokeStyle = "#d8d8d8";
            c.lineWidth = Math.max(1, w / 480);
            for (x = 1; x < 16; x += 1) { c.beginPath(); c.moveTo(x * cell, 0); c.lineTo(x * cell, h); c.stroke(); }
            for (y = 1; y * cell < h; y += 1) { c.beginPath(); c.moveTo(0, y * cell); c.lineTo(w, y * cell); c.stroke(); }

            c.save();
            c.beginPath();
            c.arc(cx, cy, r, 0, Math.PI * 2);
            c.clip();
            ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"].forEach(function (colour, i) {
                c.fillStyle = colour;
                c.fillRect(cx - r + i * (2 * r / 7), cy - r, 2 * r / 7 + 1, r * 0.72);
            });
            var g = c.createLinearGradient(cx - r, 0, cx + r, 0);
            g.addColorStop(0, "#000");
            g.addColorStop(1, "#fff");
            c.fillStyle = g;
            c.fillRect(cx - r, cy - r * 0.28, 2 * r, r * 0.3);
            c.fillStyle = "#101012";
            c.fillRect(cx - r, cy + r * 0.02, 2 * r, r * 0.4);
            for (x = 0; x < 28; x += 1) {
                c.fillStyle = x % 2 ? "#fff" : "#000";
                c.fillRect(cx - r + x * (2 * r / 28), cy + r * 0.42, 2 * r / 28 + 1, r * 0.2);
            }
            c.fillStyle = "#2aa889";
            c.fillRect(cx - r, cy + r * 0.62, 2 * r, r * 0.4);
            c.fillStyle = "#fff";
            c.font = "700 " + Math.round(r * 0.2) + "px 'IBM Plex Sans', sans-serif";
            c.textAlign = "center";
            c.textBaseline = "middle";
            c.fillText("PATINA", cx, cy + r * 0.8);
            c.font = "600 " + Math.round(r * 0.16) + "px 'IBM Plex Sans', sans-serif";
            c.fillText(timecode(t), cx, cy + r * 0.22);
            c.restore();

            c.strokeStyle = "#fff";
            c.lineWidth = Math.max(1.5, w / 400);
            c.beginPath();
            c.arc(cx, cy, r, 0, Math.PI * 2);
            c.stroke();

            /* A sweep, so that a frozen picture can be told from a live one. */
            var angle = (t % 60) / 60 * Math.PI * 2 - Math.PI / 2;
            c.beginPath();
            c.moveTo(cx, cy);
            c.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
            c.stroke();
        };
    }

    var MANDELBROT_CHAPTERS = [
        [0, "The Whole Set"], [92, "Seahorse Valley"], [184, "Elephant Valley"], [276, "The Needle"]
    ];

    /* The Mandelbrot Set first, out of the folder's order: it is what the window
       opens on, and the best of them to look at. */
    var FILES = [
        {
            name: "Mandelbrot Set.mkv", length: 365, seen: 0, chapters: MANDELBROT_CHAPTERS,
            make: function () { return mandelbrot(MANDELBROT_CHAPTERS); },
            subs: ["z² + c. That is the whole script.", "It goes on like this.", "[the edge is as long as you like]"]
        },
        {
            name: "Bars and Tone.mkv", length: 154, seen: 1, make: bars,
            chapters: [[0, "Bars"], [60, "More Bars"], [120, "Bars, Concluded"]],
            subs: ["[steady tone]", "[the tone continues]", "[nobody has touched anything]"]
        },
        {
            name: "Colour Spectrum.mkv", length: 201, seen: 0.22, make: spectrum,
            chapters: [[0, "Red to Red"], [100, "Red to Red, Again"]],
            subs: ["Every hue, in order.", "Then every hue, in order.", "[it does not get old]"]
        },
        {
            name: "Game of Life.mkv", length: 318, seen: 0, make: life,
            chapters: [[0, "First Soup"], [120, "Second Soup"], [240, "Third Soup"]],
            subs: ["Three neighbours, and a cell is born.", "Two or three, and it stays.", "Any fewer or any more, and it's gone."]
        },
        {
            name: "Gradient Drift.mkv", length: 427, seen: 0, make: drift,
            chapters: [[0, "Drifting"], [214, "Still Drifting"]],
            subs: ["[colours move, unhurried]", "[banding, if your display has any]"]
        },
        {
            name: "Rule 110.mkv", length: 246, seen: 0, make: rule110,
            chapters: [[0, "Random Start"], [123, "Things Settle"]],
            subs: ["Each row follows from the one before.", "This one can compute anything."]
        },
        {
            name: "Test Card.mkv", length: 189, seen: 0, make: card,
            chapters: [[0, "Test Card"]],
            subs: ["[please stand by]", "[still standing by]"]
        }
    ];

    var FOLDER = "~/Videos/Test Patterns";
    var ARROW_SPEEDS = [0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16, 32];

    /* ------------------------------------------- pictures that stay still */

    /* The library's cards are frames from the same patterns. */
    function drawStills() {
        Array.prototype.forEach.call(document.querySelectorAll("canvas[data-pattern]"), function (canvas) {
            var file = FILES[parseInt(canvas.dataset.pattern, 10)];
            canvas.width = 320;
            canvas.height = 180;
            file.make()(canvas.getContext("2d"), 320, 180, parseFloat(canvas.dataset.time), file.length);
        });
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(drawStills);
    } else {
        drawStills();
    }

    /* ------------------------------------------------------- the window */

    var player = document.getElementById("player");
    if (!player) { return; }

    function $(id) { return document.getElementById(id); }

    var canvas = $("video");
    var context = canvas.getContext("2d");
    canvas.width = 1280;
    canvas.height = 720;

    var slot = $("playerSlot"), stage = $("stage");
    var picture = $("picture"), subsEl = $("subs");
    var osdEl = $("osd"), osdText = $("osdText"), osdDetail = $("osdDetail"), osdBar = $("osdBar");
    var osc = $("osc"), seek = $("seek");
    var previewEl = $("preview"), previewCanvas = $("previewCanvas");
    var previewTime = $("previewTime"), previewChapter = $("previewChapter");
    var sidebar = $("sidebar");
    var previewContext = previewCanvas.getContext("2d");
    previewCanvas.width = 352;
    previewCanvas.height = 198;

    var state = {
        index: 0,
        time: 8,
        paused: reduced.matches,
        speed: 1,
        volume: 62,
        muted: false,
        loopFile: false,
        loopList: true,
        shuffle: false,
        a: -1,
        b: -1,
        remaining: false,
        panel: null,
        rotation: 0,
        flip: false,
        mirror: false,
        aspect: 0,
        colour: { brightness: 0, contrast: 0, saturation: 0, gamma: 0, hue: 0 },
        audioDelay: 0,
        subsOn: false,
        subDelay: 0,
        subScale: 1,
        subPosition: 100
    };

    var draws = FILES.map(function () { return null; });
    var previewDraws = FILES.map(function () { return null; });

    function file() { return FILES[state.index]; }

    function drawFrame() {
        if (!draws[state.index]) { draws[state.index] = file().make(); }
        draws[state.index](context, canvas.width, canvas.height, state.time, file().length);
    }

    /* ---------------------------------------------- what the OSD says */

    var osdTimer = null;

    function osd(text, detail, progress) {
        osdText.textContent = text;
        osdDetail.textContent = detail || "";
        osdDetail.hidden = !detail;
        osdBar.hidden = progress === undefined || progress === null;
        if (!osdBar.hidden) { osdBar.firstElementChild.style.width = (clamp(progress, 0, 1) * 100) + "%"; }
        osdEl.classList.add("is-on");
        window.clearTimeout(osdTimer);
        osdTimer = window.setTimeout(function () { osdEl.classList.remove("is-on"); }, 1000);
    }

    function chapterAt(item, time) {
        var found = item.chapters[0], i;
        for (i = 0; i < item.chapters.length; i += 1) {
            if (time >= item.chapters[i][0]) { found = item.chapters[i]; }
        }
        return found;
    }

    function osdSeek() {
        osd(clock(state.time) + " / " + clock(file().length),
            chapterAt(file(), state.time)[1], state.time / file().length);
    }

    function delayText(value) {
        var rounded = Math.round(value * 100) / 100;
        return rounded === 0 ? "0 s" : (rounded > 0 ? "+" : "") + rounded + " s";
    }

    /* ------------------------------------------- the controls fade away */

    var hideTimer = null;
    var holdUntil = 0;

    function controlsHeld() {
        return dragging || seekDragging || state.panel !== null || osc.matches(":hover") ||
            player.matches(".is-pip") || osc.contains(document.activeElement) ||
            reduced.matches;
    }

    function wake() {
        player.classList.remove("is-idle");
        window.clearTimeout(hideTimer);
        var wait = Math.max(2500, holdUntil - Date.now());
        hideTimer = window.setTimeout(function () {
            if (controlsHeld()) { wake(); return; }
            player.classList.add("is-idle");
        }, wait);
    }

    function sleep() {
        window.clearTimeout(hideTimer);
        if (!controlsHeld()) { player.classList.add("is-idle"); }
    }

    /* ----------------------------------------------- painting the chrome */

    var nowEl = $("oscNow"), endEl = $("oscEnd");
    var fillEl = $("seekFill"), cacheEl = $("seekCache"), abEl = $("seekAb"), knobEl = $("seekKnob");
    var titleEl = $("tbTitle");
    var lastShown = "", lastEnd = "";

    function paintClock() {
        var length = file().length;
        var fraction = clamp(state.time / length, 0, 1);
        var percent = (fraction * 100).toFixed(3) + "%";
        fillEl.style.width = percent;
        knobEl.style.left = percent;
        cacheEl.style.width = (clamp((state.time + 48) / length, 0, 1) * 100).toFixed(2) + "%";

        var shown = clock(state.time);
        if (shown !== lastShown) {
            lastShown = shown;
            nowEl.textContent = shown;
            seek.setAttribute("aria-valuenow", String(Math.floor(state.time)));
            seek.setAttribute("aria-valuetext", shown);
        }
        var end = state.remaining ? "-" + clock(length - state.time) : clock(length);
        if (end !== lastEnd) { lastEnd = end; endEl.textContent = end; }

        paintSubs();
        paintSeenBar();
    }

    function paintAb() {
        var length = file().length;
        abEl.hidden = state.a < 0;
        if (state.a >= 0) {
            var end = state.b >= 0 ? state.b : state.a + length * 0.004;
            abEl.style.left = (state.a / length * 100) + "%";
            abEl.style.width = ((end - state.a) / length * 100) + "%";
        }
    }

    function paintTicks() {
        Array.prototype.forEach.call(seek.querySelectorAll(".seek-tick"), function (tick) { tick.remove(); });
        file().chapters.forEach(function (chapter) {
            if (chapter[0] <= 0) { return; }
            var tick = document.createElement("span");
            tick.className = "seek-tick";
            tick.style.left = (chapter[0] / file().length * 100) + "%";
            seek.insertBefore(tick, knobEl);
        });
        seek.setAttribute("aria-valuemax", String(file().length));
    }

    function paintSpeed() {
        var label = $("oscSpeed");
        label.hidden = state.speed === 1;
        label.textContent = speedText(state.speed);
        label.style.left = state.speed < 1 ? "auto" : "148px";
        label.style.right = state.speed < 1 ? "148px" : "auto";
    }

    function paintVolume() {
        var value = state.muted ? 0 : state.volume;
        var slider = $("volume");
        slider.value = String(state.volume);
        slider.style.setProperty("--v", value + "%");
        var icon = value <= 0 ? "volume-x" : value < 34 ? "volume" : value < 67 ? "volume-1" : "volume-2";
        $("muteIcon").setAttribute("href", "#i-" + icon);
        $("mute").setAttribute("aria-label", state.muted ? "Unmute" : "Mute");
        $("mute").title = state.muted ? "Unmute" : "Mute";
    }

    function paintPause() {
        player.classList.toggle("is-paused", state.paused);
        var word = state.paused ? "Play" : "Pause";
        $("oscPlay").setAttribute("aria-label", word);
        $("oscPlay").title = word;
        $("pipPlay").setAttribute("aria-label", word);
        renderRows();
    }

    /* ------------------------------------- the size and shape of the picture */

    function layoutPicture() {
        var W = player.clientWidth, H = player.clientHeight;
        if (!W || !H) { return; }
        var ratio = state.aspect || 16 / 9;
        var sideways = state.rotation % 180 !== 0;
        var boxRatio = sideways ? 1 / ratio : ratio;
        var bw = W, bh = W / boxRatio;
        if (bh > H) { bh = H; bw = H * boxRatio; }
        var cw = sideways ? bh : bw, ch = sideways ? bw : bh;
        canvas.style.width = cw + "px";
        canvas.style.height = ch + "px";
        canvas.style.transform = "rotate(" + state.rotation + "deg) scale(" +
            (state.mirror ? -1 : 1) + "," + (state.flip ? -1 : 1) + ")";

        var c = state.colour;
        var filters = [];
        if (c.brightness) { filters.push("brightness(" + (1 + c.brightness / 100) + ")"); }
        if (c.contrast) { filters.push("contrast(" + (1 + c.contrast / 100) + ")"); }
        if (c.saturation) { filters.push("saturate(" + (1 + c.saturation / 100) + ")"); }
        if (c.hue) { filters.push("hue-rotate(" + c.hue + "deg)"); }
        if (c.gamma) {
            /* mpv's gamma runs -100 to 100; a table on each channel, in the
               filter defined in the page. */
            var exponent = String(Math.pow(2, -c.gamma / 50));
            ["gammaR", "gammaG", "gammaB"].forEach(function (id) { $(id).setAttribute("exponent", exponent); });
            filters.push("url(#gamma)");
        }
        canvas.style.filter = filters.join(" ");

        subsEl.style.setProperty("--subs-size", Math.max(14, H * 0.045) + "px");
        subsEl.style.setProperty("--subs-scale", String(state.subScale));
        /* Clear of the controller where it sits by default, which mpv's own bottom
           margin would not be. */
        subsEl.style.bottom = (Math.min(H * 0.2, 112) + (100 - state.subPosition) / 100 * H) + "px";

        clampDrag();
    }

    var lastSub = null;

    function paintSubs() {
        var text = "";
        if (state.subsOn) {
            var shifted = state.time - state.subDelay;
            var lines = file().subs;
            if (shifted >= 0 && (shifted % 12) < 5) {
                text = lines[Math.floor(shifted / 12) % lines.length];
            }
        }
        if (text !== lastSub) { lastSub = text; subsEl.textContent = text; }
    }

    /* ------------------------------------------------------ the playlist */

    var rowsEl = $("rows"), chaptersEl = $("chapters");
    var seenBars = [];

    function renderRows() {
        rowsEl.textContent = "";
        seenBars = [];
        FILES.forEach(function (item, index) {
            var row = document.createElement("button");
            row.type = "button";
            row.className = "row" + (index === state.index ? " is-current" : "");
            row.setAttribute("aria-current", index === state.index ? "true" : "false");

            var n = document.createElement("span");
            n.className = "row-n";
            if (index === state.index) {
                n.innerHTML = '<svg class="ico ico-fill" aria-hidden="true"><use href="#i-' +
                    (state.paused ? "pause" : "play") + '"/></svg>';
            } else {
                n.textContent = String(index + 1);
            }

            var id = document.createElement("span");
            id.className = "row-id";
            var title = document.createElement("span");
            title.className = "row-title";
            title.textContent = item.name;
            var sub = document.createElement("span");
            sub.className = "row-sub";
            sub.textContent = FOLDER;
            id.appendChild(title);
            id.appendChild(sub);

            var time = document.createElement("span");
            time.className = "row-time";
            time.textContent = clock(item.length);

            var seen = document.createElement("span");
            seen.className = "row-seen";
            seenBars.push(seen);

            row.appendChild(n);
            row.appendChild(id);
            row.appendChild(time);
            row.appendChild(seen);
            row.addEventListener("click", function () { open(index); });
            rowsEl.appendChild(row);
        });
        paintSeenBar();
    }

    function paintSeenBar() {
        var i, width;
        for (i = 0; i < seenBars.length; i += 1) {
            /* The bar spans the title's column, whose width is what is left of
               the row after the number and the length. */
            width = FILES[i].seen * 240;
            seenBars[i].style.width = width + "px";
            seenBars[i].hidden = width <= 0 || i === state.index;
        }
    }

    function renderChapters() {
        chaptersEl.textContent = "";
        var current = chapterAt(file(), state.time);
        file().chapters.forEach(function (chapter, index) {
            var row = document.createElement("button");
            row.type = "button";
            row.className = "row row-chapter" + (chapter === current ? " is-current" : "");
            row.innerHTML = '<span class="row-n"></span><span class="row-id"><span class="row-title"></span></span><span class="row-time"></span>';
            row.querySelector(".row-n").textContent = String(index + 1);
            row.querySelector(".row-title").textContent = chapter[1];
            row.querySelector(".row-time").textContent = clock(chapter[0]);
            row.addEventListener("click", function () { seekTo(chapter[0]); osdSeek(); });
            chaptersEl.appendChild(row);
        });
    }

    function open(index, keepTime) {
        if (index !== state.index) {
            /* What you watched of the one you are leaving. */
            var leaving = file();
            leaving.seen = Math.max(leaving.seen, state.time / leaving.length);
        }
        state.index = clamp(index, 0, FILES.length - 1);
        state.time = keepTime || 0;
        state.a = -1;
        state.b = -1;
        titleEl.textContent = file().name;
        paintTicks();
        paintAb();
        renderRows();
        renderChapters();
        drawFrame();
        sampleGlow();
        paintClock();
    }

    function seekTo(time) {
        state.time = clamp(time, 0, Math.max(0, file().length - 0.05));
        drawFrame();
        paintClock();
        renderChapterMark();
    }

    var markedChapter = null;

    function renderChapterMark() {
        var current = chapterAt(file(), state.time);
        if (current !== markedChapter) {
            markedChapter = current;
            if (state.panel === "chapters") { renderChapters(); }
        }
    }

    function nextIndex(direction) {
        if (state.shuffle) {
            return (state.index + 1 + Math.floor(Math.random() * (FILES.length - 1))) % FILES.length;
        }
        return (state.index + direction + FILES.length) % FILES.length;
    }

    function ended() {
        if (state.loopFile) { state.time = 0; return; }
        if (state.index === FILES.length - 1 && !state.loopList && !state.shuffle) {
            state.time = file().length - 0.05;
            state.paused = true;
            paintPause();
            return;
        }
        open(nextIndex(1));
    }

    /* ---------------------------------------------------- the transport */

    function togglePause() {
        state.paused = !state.paused;
        paintPause();
        osd(state.paused ? "Pause" : "Resume");
    }

    function setSpeed(value, quiet) {
        state.speed = clamp(value, 0.03125, 32);
        paintSpeed();
        if (!quiet) { osd("Speed: " + speedText(state.speed)); }
        syncSpeedPanel();
    }

    /* src/window.rs's arrow_button: above 1× the left arrow goes straight back
       to 1×, below it the right arrow does, and either way it plays. */
    function arrow(left) {
        var next;
        if (left) {
            if (state.speed > 1) { next = 1; }
            else {
                next = ARROW_SPEEDS.slice().reverse().filter(function (s) { return s < state.speed - 1e-6; })[0] || ARROW_SPEEDS[0];
            }
        } else if (state.speed < 1) {
            next = 1;
        } else {
            next = ARROW_SPEEDS.filter(function (s) { return s > state.speed + 1e-6; })[0] || ARROW_SPEEDS[10];
        }
        setSpeed(next);
        if (state.paused) { state.paused = false; paintPause(); }
    }

    function setVolume(value) {
        state.volume = clamp(Math.round(value), 0, 100);
        state.muted = false;
        paintVolume();
        osd("Volume: " + state.volume, "", state.volume / 100);
    }

    function toggleMute() {
        state.muted = !state.muted;
        paintVolume();
        osd(state.muted ? "Mute" : "Unmute");
    }

    function abLoop() {
        if (state.a < 0) {
            state.a = state.time;
            osd("A-B Loop: A = " + clock(state.a));
        } else if (state.b < 0) {
            if (state.time <= state.a) { return; }
            state.b = state.time;
            osd("A-B Loop: " + clock(state.a) + " → " + clock(state.b));
        } else {
            state.a = -1;
            state.b = -1;
            osd("A-B Loop: Off");
        }
        paintAb();
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else if (player.requestFullscreen) {
            if (player.classList.contains("is-pip")) { togglePip(); }
            player.requestFullscreen().catch(function () { /* Refused; nothing to do. */ });
        }
    }

    function togglePip() {
        var on = !player.classList.contains("is-pip");
        player.classList.toggle("is-pip", on);
        $("pipNote").hidden = !on;
        wake();
        layoutPicture();
    }

    /* ---------------------------------------------- the sidebar's panels */

    var PLAYLIST_GROUP = ["playlist", "chapters"];
    var SETTINGS_GROUP = ["video", "audio", "subtitles"];
    var TAB_NAMES = { playlist: "Playlist", chapters: "Chapters", video: "Video", audio: "Audio", subtitles: "Subtitles" };
    var segmentEl = $("sideTabs");

    function setPanel(panel) {
        state.panel = panel;
        sidebar.hidden = panel === null;
        player.classList.toggle("has-sidebar", panel !== null);
        player.style.setProperty("--sidebar", panel !== null && player.clientWidth > 760 ? "340px" : "0px");

        var inPlaylist = PLAYLIST_GROUP.indexOf(panel) >= 0;
        var inSettings = SETTINGS_GROUP.indexOf(panel) >= 0;
        $("toolPlaylist").classList.toggle("is-active", inPlaylist);
        $("toolSettings").classList.toggle("is-active", inSettings);
        $("toolPlaylist").setAttribute("aria-pressed", String(inPlaylist));
        $("toolSettings").setAttribute("aria-pressed", String(inSettings));

        if (panel !== null) {
            segmentEl.textContent = "";
            (inPlaylist ? PLAYLIST_GROUP : SETTINGS_GROUP).forEach(function (tab) {
                var button = document.createElement("button");
                button.type = "button";
                button.textContent = TAB_NAMES[tab];
                button.setAttribute("aria-pressed", String(tab === panel));
                button.addEventListener("click", function () { setPanel(tab); });
                segmentEl.appendChild(button);
            });
            ["playlist", "chapters", "video", "audio", "subtitles"].forEach(function (name) {
                $("panel-" + name).hidden = name !== panel;
            });
            if (panel === "chapters") { renderChapters(); }
        }
        clampDrag();
        wake();
    }

    function togglePanel(group, first) {
        setPanel(group.indexOf(state.panel) >= 0 ? null : first);
    }

    /* A row of choices in a panel, each a button. */
    function choices(container, options, chosen, onChoose) {
        var el = $(container);
        el.textContent = "";
        options.forEach(function (option, index) {
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = option;
            button.setAttribute("aria-pressed", String(index === chosen));
            button.addEventListener("click", function () {
                Array.prototype.forEach.call(el.children, function (other) {
                    other.setAttribute("aria-pressed", String(other === button));
                });
                onChoose(index);
            });
            el.appendChild(button);
        });
    }

    function slider(id, read, onInput) {
        var input = $(id), out = $(id + "Read");
        function paint() {
            var span = parseFloat(input.max) - parseFloat(input.min);
            input.style.setProperty("--v", ((parseFloat(input.value) - parseFloat(input.min)) / span * 100) + "%");
            if (out) { out.textContent = read(parseFloat(input.value)); }
        }
        input.addEventListener("input", function () {
            onInput(parseFloat(input.value));
            paint();
        });
        paint();
        return { input: input, paint: paint };
    }

    var ASPECTS = [0, 4 / 3, 16 / 9, 16 / 10, 21 / 9, 5 / 4];
    var ASPECT_NAMES = ["Default", "4:3", "16:9", "16:10", "21:9", "5:4"];

    choices("aspectChoices", ASPECT_NAMES, 0, function (index) {
        state.aspect = ASPECTS[index];
        layoutPicture();
        osd("Aspect Ratio: " + ASPECT_NAMES[index]);
    });
    choices("rotationChoices", ["0°", "90°", "180°", "270°"], 0, function (index) {
        state.rotation = index * 90;
        layoutPicture();
        osd("Rotation: " + state.rotation + "°");
    });

    $("flip").addEventListener("change", function (event) {
        state.flip = event.target.checked;
        layoutPicture();
        osd("Flip: " + (state.flip ? "On" : "Off"));
    });
    $("mirror").addEventListener("change", function (event) {
        state.mirror = event.target.checked;
        layoutPicture();
        osd("Mirror: " + (state.mirror ? "On" : "Off"));
    });

    var speedSlider = slider("speedRange", function (value) {
        return speedText(Math.pow(2, value));
    }, function (value) {
        setSpeed(Math.pow(2, value));
    });

    function syncSpeedPanel() {
        speedSlider.input.value = String(Math.log2(state.speed));
        speedSlider.paint();
    }

    ["brightness", "contrast", "saturation", "gamma", "hue"].forEach(function (name) {
        /* "gamma" on its own is the filter's id. */
        var id = name === "gamma" ? "gamma-range" : name;
        slider(id, function (value) { return String(Math.round(value)); }, function (value) {
            state.colour[name] = value;
            layoutPicture();
            osd(name.charAt(0).toUpperCase() + name.slice(1) + ": " + Math.round(value), "", null);
        });
    });

    var audioDelay = slider("audioDelay", delayText, function (value) {
        state.audioDelay = value;
        osd("Audio Delay: " + delayText(value));
    });

    var EQ_NAMES = ["32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
    var eqEl = $("eq");
    EQ_NAMES.forEach(function (name) {
        var band = document.createElement("label");
        band.className = "eq-band";
        var input = document.createElement("input");
        input.type = "range";
        input.min = "-12";
        input.max = "12";
        input.step = "1";
        input.value = "0";
        input.setAttribute("aria-label", name + " Hz");
        band.appendChild(input);
        band.appendChild(document.createTextNode(name));
        eqEl.appendChild(band);
    });
    $("eqReset").addEventListener("click", function () {
        Array.prototype.forEach.call(eqEl.querySelectorAll("input"), function (input) { input.value = "0"; });
    });

    function setSubsOn(on) {
        state.subsOn = on;
        $("subsShow").checked = on;
        $("trackNone").setAttribute("aria-pressed", String(!on));
        $("trackEnglish").setAttribute("aria-pressed", String(on));
        paintClock();
    }
    $("subsShow").addEventListener("change", function (event) {
        setSubsOn(event.target.checked);
        osd(event.target.checked ? "Subtitles Shown" : "Subtitles Hidden");
    });
    $("trackNone").addEventListener("click", function () { setSubsOn(false); osd("Subtitle: None"); });
    $("trackEnglish").addEventListener("click", function () { setSubsOn(true); osd("Subtitle: 1 English"); });

    var subDelay = slider("subDelay", delayText, function (value) {
        state.subDelay = value;
        osd("Subtitle Delay: " + delayText(value));
        paintClock();
    });
    slider("subScale", function (value) { return speedText(value); }, function (value) {
        state.subScale = value;
        layoutPicture();
        osd("Subtitle Scale: " + speedText(value));
    });
    slider("subPosition", function (value) { return String(Math.round(value)); }, function (value) {
        state.subPosition = value;
        layoutPicture();
        osd("Subtitle Position: " + Math.round(value));
    });

    /* --------------------------------------- dragging the controller about */

    var dragging = false, dragStart = null, drag = { x: 0, y: 0 };

    function clampDrag() {
        var W = player.clientWidth, H = player.clientHeight;
        var width = osc.offsetWidth, height = osc.offsetHeight;
        var side = parseFloat(player.style.getPropertyValue("--sidebar")) || 0;
        var room = (W - side - width) / 2;
        var roomUp = H - height - 24 - 32;
        drag.x = clamp(drag.x, -room, room + side);
        drag.y = clamp(drag.y, -Math.max(0, roomUp), 24);
        osc.style.setProperty("--drag-x", drag.x + "px");
        osc.style.setProperty("--drag-y", drag.y + "px");
    }

    osc.addEventListener("pointerdown", function (event) {
        if (event.button !== 0 || event.target.closest("button, input, #seek")) { return; }
        if (player.clientWidth <= 760) { return; }
        dragging = true;
        dragStart = { x: event.clientX - drag.x, y: event.clientY - drag.y };
        osc.setPointerCapture(event.pointerId);
        osc.style.cursor = "grabbing";
    });
    osc.addEventListener("pointermove", function (event) {
        if (!dragging) { return; }
        drag.x = event.clientX - dragStart.x;
        drag.y = event.clientY - dragStart.y;
        clampDrag();
    });
    function endDrag() { dragging = false; osc.style.cursor = ""; }
    osc.addEventListener("pointerup", endDrag);
    osc.addEventListener("pointercancel", endDrag);

    /* ---------------------------------------------------- the seek bar */

    var seekDragging = false;
    var previewFrame = null, previewAt = null;

    function timeAt(event) {
        var box = seek.getBoundingClientRect();
        return clamp((event.clientX - box.left) / box.width, 0, 1) * file().length;
    }

    function showPreview(event) {
        var host = player.getBoundingClientRect();
        previewAt = timeAt(event);
        previewEl.hidden = false;
        var width = previewEl.offsetWidth;
        var x = event.clientX - host.left - width / 2;
        previewEl.style.left = clamp(x, 8, host.width - width - 8) + "px";
        var above = host.bottom - osc.getBoundingClientRect().top + 8;
        previewEl.style.bottom = above + "px";
        if (previewFrame === null) {
            previewFrame = window.requestAnimationFrame(paintPreview);
        }
    }

    function paintPreview() {
        previewFrame = null;
        if (previewAt === null) { return; }
        if (!previewDraws[state.index]) { previewDraws[state.index] = file().make(); }
        previewDraws[state.index](previewContext, previewCanvas.width, previewCanvas.height,
            previewAt, file().length);
        previewTime.textContent = clock(previewAt);
        previewChapter.textContent = chapterAt(file(), previewAt)[1];
    }

    function hidePreview() {
        previewAt = null;
        previewEl.hidden = true;
    }

    seek.addEventListener("pointerdown", function (event) {
        if (event.button !== 0) { return; }
        seekDragging = true;
        seek.setPointerCapture(event.pointerId);
        seekTo(timeAt(event));
    });
    seek.addEventListener("pointermove", function (event) {
        if (seekDragging) { seekTo(timeAt(event)); }
        if (event.pointerType === "mouse") { showPreview(event); }
    });
    function endSeek(event) {
        seekDragging = false;
        if (event.pointerType !== "mouse") { hidePreview(); }
    }
    seek.addEventListener("pointerup", endSeek);
    seek.addEventListener("pointercancel", endSeek);
    seek.addEventListener("pointerleave", function () { if (!seekDragging) { hidePreview(); } });

    /* ------------------------------------------------- pointer and clicks */

    player.addEventListener("pointermove", function (event) {
        if (event.pointerType === "mouse") { wake(); }
    });
    player.addEventListener("pointerleave", function () {
        hidePreview();
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(sleep, 600);
    });

    /* A click shows or hides the controls, and a double click is full screen,
       as the app's defaults have it. */
    picture.addEventListener("click", function () {
        player.focus({ preventScroll: true });
        if (player.classList.contains("is-idle")) { wake(); }
        else {
            holdUntil = 0;
            window.clearTimeout(hideTimer);
            player.classList.add("is-idle");
        }
    });
    picture.addEventListener("dblclick", toggleFullscreen);

    /* ------------------------------------------------------ the buttons */

    $("oscPlay").addEventListener("click", togglePause);
    $("oscLeft").addEventListener("click", function () { arrow(true); });
    $("oscRight").addEventListener("click", function () { arrow(false); });
    $("mute").addEventListener("click", toggleMute);
    $("volume").addEventListener("input", function (event) { setVolume(parseFloat(event.target.value)); });
    $("toolPlaylist").addEventListener("click", function () { togglePanel(PLAYLIST_GROUP, "playlist"); });
    $("toolSettings").addEventListener("click", function () { togglePanel(SETTINGS_GROUP, "video"); });
    $("toolPip").addEventListener("click", togglePip);
    $("tbPip").addEventListener("click", togglePip);
    $("pipReturn").addEventListener("click", togglePip);
    $("pipBack").addEventListener("click", togglePip);
    $("pipPlay").addEventListener("click", togglePause);
    $("sideClose").addEventListener("click", function () { setPanel(null); });

    endEl.addEventListener("click", function () {
        state.remaining = !state.remaining;
        paintClock();
    });

    function loopButton(id, read, flip, word) {
        var button = $(id);
        function paint() {
            button.classList.toggle("is-active", read());
            button.setAttribute("aria-pressed", String(read()));
        }
        button.addEventListener("click", function () {
            flip();
            paint();
            osd(word + ": " + (read() ? "On" : "Off"));
        });
        paint();
    }
    loopButton("loopFile", function () { return state.loopFile; },
        function () { state.loopFile = !state.loopFile; }, "Loop File");
    loopButton("loopList", function () { return state.loopList; },
        function () { state.loopList = !state.loopList; }, "Loop Playlist");
    loopButton("shuffle", function () { return state.shuffle; },
        function () { state.shuffle = !state.shuffle; }, "Shuffle");

    /* -------------------------------------------------------- the keys */

    /* README.md's table, less what the browser will not give up (Ctrl+W,
       Ctrl+O) and what opens a window this page has no copy of. They work only
       while focus is in the window: this page has to keep its own scrolling. */
    player.addEventListener("keydown", function (event) {
        var target = event.target;
        var key = event.key;
        var control = event.ctrlKey || event.metaKey;
        var onField = target.tagName === "INPUT";
        var onButton = target.tagName === "BUTTON";

        if (onField && /^Arrow|^Home$|^End$/.test(key) && !control) { return; }
        if (onButton && (key === " " || key === "Enter")) { return; }

        var handled = true;
        if (!control && !event.altKey && (key === " " || key === "p")) { togglePause(); }
        else if (!control && !event.altKey && key === "ArrowLeft") { seekTo(state.time - 5); osdSeek(); }
        else if (!control && !event.altKey && key === "ArrowRight") { seekTo(state.time + 5); osdSeek(); }
        else if (control && key === "ArrowLeft") { open(nextIndex(-1)); }
        else if (control && key === "ArrowRight") { open(nextIndex(1)); }
        else if (!control && key === "ArrowUp") { setVolume(state.volume + 5); }
        else if (!control && key === "ArrowDown") { setVolume(state.volume - 5); }
        else if (control && key === "[") { setSpeed(state.speed / 2); }
        else if (control && key === "]") { setSpeed(state.speed * 2); }
        else if (control && key === "\\") { setSpeed(1); }
        else if (!control && !event.altKey && (key === "f" || key === "Enter" || key === "F11")) { toggleFullscreen(); }
        else if (control && (key === "l" || key === "L")) { abLoop(); }
        else if (!control && key === "Z") { nudgeSub(-0.1); }
        else if (!control && key === "X") { nudgeSub(0.1); }
        else if (!control && key === "C") { nudgeSub(0); }
        else if (!control && key === "(") { nudgeAudio(-0.1); }
        else if (!control && key === ")") { nudgeAudio(0.1); }
        else if (!control && key === "_") { nudgeAudio(0); }
        else { handled = false; }

        if (handled) {
            event.preventDefault();
            wake();
        }
    });

    function nudgeSub(by) {
        state.subDelay = by === 0 ? 0 : clamp(state.subDelay + by, -10, 10);
        subDelay.input.value = String(state.subDelay);
        subDelay.paint();
        osd("Subtitle Delay: " + delayText(state.subDelay));
        paintClock();
    }

    function nudgeAudio(by) {
        state.audioDelay = by === 0 ? 0 : clamp(state.audioDelay + by, -10, 10);
        audioDelay.input.value = String(state.audioDelay);
        audioDelay.paint();
        osd("Audio Delay: " + delayText(state.audioDelay));
    }

    /* -------------------------------------------- the light on the wall */

    var glowCanvas = document.createElement("canvas");
    glowCanvas.width = 8;
    glowCanvas.height = 5;
    var glowContext = glowCanvas.getContext("2d", { willReadFrequently: true });

    function sampleGlow() {
        glowContext.drawImage(canvas, 0, 0, 8, 5);
        var data = glowContext.getImageData(0, 0, 8, 5).data, r = 0, g = 0, b = 0, i;
        for (i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
        var n = data.length / 4;
        stage.style.setProperty("--glow",
            "rgb(" + Math.round(r / n) + " " + Math.round(g / n) + " " + Math.round(b / n) + ")");
    }

    /* ------------------------------------------------------- the clock */

    var visible = true, previous = 0, sinceDraw = 0, sinceGlow = 0;

    if (window.IntersectionObserver) {
        new IntersectionObserver(function (entries) {
            visible = entries[entries.length - 1].isIntersecting;
            if (visible && !holdUntil) {
                /* The window fades as soon as nobody is touching it, which is
                   the point of it. But the first time it comes on screen
                   someone should get a look at the controls first. */
                holdUntil = Date.now() + 6000;
                wake();
            }
        }, { threshold: 0.2 }).observe(player);
    }

    function frame(now) {
        window.requestAnimationFrame(frame);
        var dt = Math.min(0.1, (now - previous) / 1000);
        previous = now;
        if (!visible || document.hidden || state.paused) { return; }

        state.time += dt * state.speed;
        if (state.b >= 0 && state.time >= state.b) { state.time = state.a; }
        if (state.time >= file().length) { ended(); }

        sinceDraw += dt;
        sinceGlow += dt;
        /* Thirty pictures a second is what these patterns need, and leaves the
           other half of the machine's frames to whatever else it is doing. */
        if (sinceDraw >= 1 / 30) {
            sinceDraw = 0;
            drawFrame();
            paintClock();
            renderChapterMark();
        }
        if (sinceGlow >= 1) {
            sinceGlow = 0;
            sampleGlow();
        }
    }

    /* ------------------------------------------------------------ start */

    if (window.ResizeObserver) {
        new ResizeObserver(function () {
            layoutPicture();
            setPanelWidthVar();
        }).observe(slot);
    } else {
        window.addEventListener("resize", layoutPicture);
    }

    function setPanelWidthVar() {
        player.style.setProperty("--sidebar", state.panel !== null && player.clientWidth > 760 ? "340px" : "0px");
        clampDrag();
    }

    player.classList.add("is-live");
    setPanel(null);
    layoutPicture();
    paintVolume();
    paintSpeed();
    paintPause();
    open(state.index, state.time);

    /* The first picture again once the face has arrived, for the two patterns
       with words in them. */
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(drawFrame);
    }

    window.requestAnimationFrame(function (now) {
        previous = now;
        window.requestAnimationFrame(frame);
    });
}());
