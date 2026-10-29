/* 0202Transition host script (ExtendScript, ES3) - keep ASCII only */
var T0202 = (function () {
    var TPS = 254016000000;
    var snaps = {};
    var TF_NAMES = ["Transform", "\uBCC0\uD615", "\uBCC0\uD658"];
    var fxCache = {};
    var lastErr = "";
    var lastAdd = null;
    var lastReport = "";

    function mkTime(ticks) {
        var t = new Time();
        t.ticks = String(Math.round(ticks));
        return t;
    }

    function seqInfo(seq) {
        var tb = Number(seq.timebase);
        return { tpf: tb, fps: TPS / tb, w: Number(seq.frameSizeHorizontal), h: Number(seq.frameSizeVertical) };
    }

    function selectedClips(seq) {
        var out = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var tr = seq.videoTracks[t];
            for (var c = 0; c < tr.clips.numItems; c++) {
                var cl = tr.clips[c];
                if (cl.isSelected()) out.push({ t: t, c: c, clip: cl });
            }
        }
        return out;
    }

    function selectedAudio(seq) {
        var out = [];
        for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            var tr = seq.audioTracks[t];
            for (var c = 0; c < tr.clips.numItems; c++) {
                var cl = tr.clips[c];
                if (cl.isSelected()) out.push({ t: t, c: c, clip: cl });
            }
        }
        return out;
    }

    function splitList(l) {
        if (!l) return [];
        if (typeof l === "string") return l.split(",");
        var r = [];
        for (var i = 0; i < l.length; i++) r.push(String(l[i]));
        return r;
    }

    /* Some third-party plugins shadow built-in names (e.g. Film Impact "Gaussian Blur").
       ALIASES lists names to try in order; first that exists wins. */
    /* Korean UI names are best-effort (\u escapes keep this file ASCII). */
    var ALIASES = {
        "Transform": TF_NAMES,
        "Gaussian Blur": ["Gaussian Blur (Legacy)", "Gaussian Blur", "Fast Blur",
            "\uAC00\uC6B0\uC2DC\uC548 \uD750\uB9BC(\uB808\uAC70\uC2DC)", "\uAC00\uC6B0\uC2DC\uC548 \uD750\uB9BC", "\uBE60\uB978 \uD750\uB9BC"],
        "Turbulent Displace": ["Turbulent Displace", "\uB4A4\uD2C0\uAE30 \uBCC0\uC704", "\uB09C\uB958 \uBCC0\uC704", "\uB09C\uAE30\uB958 \uBCC0\uC704"],
        "Posterize Time": ["Posterize Time", "\uC2DC\uAC04 \uD3EC\uC2A4\uD130\uD654"],
        "Wave Warp": ["Wave Warp", "\uBB3C\uACB0 \uBE44\uD2C0\uAE30"],
        "Tint": ["Tint", "\uC0C9\uC870"],
        "Brightness & Contrast": ["Brightness & Contrast", "\uBC1D\uAE30 \uBC0F \uB300\uBE44"],
        "ProcAmp": ["ProcAmp", "\uBE44\uB514\uC624 \uD504\uB85C\uC138\uC2A4 \uC570\uD504"],
        "Crop": ["Crop", "\uC790\uB974\uAE30"],
        "Ramp": ["Ramp", "\uADF8\uB77C\uB514\uC5B8\uD2B8 \uB7A8\uD504", "\uADF8\uB808\uC774\uB514\uC5B8\uD2B8 \uB7A8\uD504", "\uB7A8\uD504"],
        "Alpha Adjust": ["Alpha Adjust", "\uC54C\uD30C \uC870\uC815"],
        "Track Matte Key": ["Track Matte Key", "\uD2B8\uB799 \uB9E4\uD2B8 \uD0A4"],
        "VR Chromatic Aberrations": ["VR Chromatic Aberrations", "VR \uC0C9\uC218\uCC28"],
        "Alpha Glow": ["Alpha Glow", "\uC54C\uD30C \uAD11\uC120", "\uC54C\uD30C \uAE00\uB85C\uC6B0"]
    };

    /* parameter index fallback when display names are localized */
    var PIDX = {
        "Turbulent Displace": { "Amount": 1, "Size": 2, "Offset (Turbulence)": 3, "Complexity": 4, "Evolution": 5, "Cycle Evolution": 7, "Cycle (in Revolutions)": 8, "Random Seed": 9 },
        "Posterize Time": { "Frame Rate": 0 },
        "Wave Warp": { "Wave Type": 0, "Wave Height": 1, "Wave Width": 2, "Direction": 3, "Wave Speed": 4, "Pinning": 5, "Phase": 6 },
        "Tint": { "Map Black To": 0, "Map White To": 1, "Amount to Tint": 2 },
        "Brightness & Contrast": { "Brightness": 0, "Contrast": 1 },
        "Gaussian Blur": { "Blurriness": 0 },
        "ProcAmp": { "Brightness": 0, "Contrast": 1, "Hue": 2, "Saturation": 3 },
        "Crop": { "Left": 0, "Top": 1, "Right": 2, "Bottom": 3, "Zoom": 4, "Edge Feather": 5 },
        "Ramp": { "Start of Ramp": 0, "Start Color": 1, "End of Ramp": 2, "End Color": 3, "Ramp Shape": 4 },
        "Alpha Adjust": { "Opacity": 0, "Ignore Alpha": 1, "Invert Alpha": 2, "Mask Only": 3 },
        "Track Matte Key": { "Matte": 0, "Composite Using": 1, "Reverse": 2 },
        "VR Chromatic Aberrations": { "Aberration (Red)": 5, "Aberration (Green)": 6, "Aberration (Blue)": 7 },
        "Alpha Glow": { "Glow": 0, "Brightness": 1, "Start Color": 2, "Use End Color": 3, "End Color": 4, "Fade Out": 5 }
    };

    function getVideoFx(name) {
        if (fxCache[name]) return fxCache[name];
        var names = ALIASES[name] || [name], e = null, i;
        for (i = 0; i < names.length && !e; i++) {
            try { e = qe.project.getVideoEffectByName(names[i]); } catch (x) { e = null; }
        }
        if (!e) e = scanFx(name);
        if (e) fxCache[name] = e; else lastErr = "fx:" + name;
        return e;
    }

    /* loose patterns to find an effect in a localized effect list */
    var SCAN = {
        "Transform": [/^transform$/i, /^\uBCC0\uD615$/, /^\uBCC0\uD658$/, /^\uD2B8\uB79C\uC2A4\uD3FC$/, /\uBCC0\uD615/, /transform/i],
        "Turbulent Displace": [/turbulent displace/i, /\uB4A4\uD2C0\uAE30/, /\uB09C\uB958/, /\uB09C\uAE30\uB958/],
        "Posterize Time": [/posterize time/i, /\uC2DC\uAC04.*\uD3EC\uC2A4\uD130/, /\uD3EC\uC2A4\uD130.*\uC2DC\uAC04/],
        "Wave Warp": [/wave warp/i, /\uBB3C\uACB0/, /\uD30C\uB3C4/],
        "Tint": [/^tint$/i, /^\uC0C9\uC870$/],
        "Brightness & Contrast": [/brightness/i, /\uBC1D\uAE30/],
        "Gaussian Blur": [/gaussian/i, /\uAC00\uC6B0\uC2DC\uC548/],
        "ProcAmp": [/procamp/i, /\uD504\uB85C\uC138\uC2A4 \uC570\uD504/],
        "Crop": [/^crop$/i, /^\uC790\uB974\uAE30$/],
        "Ramp": [/^ramp$/i, /\uB7A8\uD504/],
        "Alpha Adjust": [/alpha adjust/i, /\uC54C\uD30C \uC870\uC815/],
        "Track Matte Key": [/track matte/i, /\uD2B8\uB799 \uB9E4\uD2B8/],
        "VR Chromatic Aberrations": [/chromatic aberration/i, /\uC0C9\s*\uC218\uCC28/, /chromatic/i],
        "Alpha Glow": [/alpha glow/i, /\uC54C\uD30C \uAD11/, /\uC54C\uD30C \uAE00\uB85C/]
    };
    /* matchName each effect must have once added (null = don't check) */
    var EXPECT = {
        "Transform": /^AE\.ADBE Geometry2?$/,
        "Turbulent Displace": /Turbulent Displace/,
        "Posterize Time": /Posterize Time/,
        "Wave Warp": /Wave Warp/,
        "Tint": /^AE\.ADBE Tint$/,
        "Brightness & Contrast": /Brightness/,
        "Gaussian Blur": /Gaussian Blur|Fast Blur/,
        "Crop": /Crop/i,
        "Ramp": /Ramp/,
        "Track Matte Key": /Track Matte/,
        "VR Chromatic Aberrations": /Chromatic/i,
        "Alpha Glow": /Alpha Glow|Glow/
    };
    var fxOk = {};
    function scanFx(name) {
        var n = scanNames(name);
        for (var i = 0; i < n.length; i++) { var e = null; try { e = qe.project.getVideoEffectByName(n[i]); } catch (x) {} if (e) return e; }
        return null;
    }
    function scanNames(name) {
        var pats = SCAN[name], out = [];
        if (!pats) return out;
        var list = [];
        try { list = splitList(qe.project.getVideoEffectList()); } catch (x) { return out; }
        for (var i = 0; i < pats.length; i++) {
            for (var j = 0; j < list.length; j++) {
                if (!pats[i].test(list[j]) || /^VR /.test(list[j])) continue;
                var dup = false;
                for (var k = 0; k < out.length; k++) if (out[k] === list[j]) dup = true;
                if (!dup) out.push(list[j]);
            }
        }
        return out;
    }
    function fxNames(name) {
        var r = [], a = (fxOk[name] ? [fxOk[name]] : []).concat(ALIASES[name] || [name], scanNames(name));
        for (var i = 0; i < a.length; i++) {
            var dup = false;
            for (var k = 0; k < r.length; k++) if (r[k] === a[i]) dup = true;
            if (!dup) r.push(a[i]);
        }
        return r;
    }
    /* Add an effect and make sure it really landed (localized Premiere can hand back a dud
       object for the English name). Tries every candidate name until the expected effect appears. */
    function addFxVerified(seq, ref, info, qs, name) {
        var names = fxNames(name), tried = [];
        for (var i = 0; i < names.length && i < 8; i++) {
            var obj = null;
            try { obj = qe.project.getVideoEffectByName(names[i]); } catch (x) {}
            if (!obj) continue;
            var comp = null;
            try { comp = addVideoFxTo(seq, ref, info, qs, obj); } catch (x2) { comp = null; }
            if (!comp) { tried.push(names[i] + ":none"); continue; }
            if (EXPECT[name] && !EXPECT[name].test(comp.matchName)) {
                tried.push(names[i] + ":" + comp.matchName);
                try { lastAdd.qi.getComponentAt(lastAdd.idx).remove(); } catch (x3) {}
                continue;
            }
            fxOk[name] = names[i];
            return comp;
        }
        lastErr = "fx " + name + " [" + tried.join(", ") + "] " + lastErr;
        return null;
    }

    function getAudioFx(name) {
        try { return qe.project.getAudioEffectByName(name); } catch (x) { return null; }
    }

    function qeTicks(it) {
        try { return Number(it.start.ticks); } catch (e) {}
        try { return Number(it.start.secs) * TPS; } catch (e2) {}
        return NaN;
    }

    /* QE items that may correspond to a DOM clip, best guess first.
       QE lists Empty gaps (and sometimes other item types) between clips, so try several strategies. */
    function qeCandidates(qt, c, clip, tpf) {
        var out = [], seen = [];
        if (!qt) return out;
        var cs = Number(clip.start.ticks), items = [], i, it;
        for (i = 0; i < qt.numItems; i++) {
            it = qt.getItemAt(i);
            if (!it || it.type === "Empty") continue;
            items.push({ it: it, st: qeTicks(it), clip: it.type === "Clip" });
        }
        function add(x) {
            for (var k = 0; k < seen.length; k++) if (seen[k] === x) return;
            seen.push(x); out.push(x);
        }
        for (i = 0; i < items.length; i++) if (!isNaN(items[i].st) && Math.abs(items[i].st - cs) < tpf / 2 && items[i].it.name === clip.name) add(items[i].it);
        for (i = 0; i < items.length; i++) if (!isNaN(items[i].st) && Math.abs(items[i].st - cs) < tpf / 2) add(items[i].it);
        var ci = 0;
        for (i = 0; i < items.length; i++) { if (!items[i].clip) continue; if (ci === c) add(items[i].it); ci++; }
        if (c < items.length) add(items[c].it);
        return out;
    }

    function qeItemFor(qt, c, clip, tpf) {
        var l = qeCandidates(qt, c, clip, tpf);
        return l.length ? l[0] : null;
    }

    function qeNames(qi) {
        var r = [];
        try { for (var k = 0; k < qi.numComponents; k++) r.push(qi.getComponentAt(k).name); } catch (e) {}
        return r;
    }

    /* if an effect landed on the wrong QE item, take it off again */
    function undoOn(qi, before) {
        try {
            var n = qi.numComponents;
            if (n <= before.length) return;
            for (var k = 0; k < n; k++) {
                if (k >= before.length || qi.getComponentAt(k).name !== before[k]) { qi.getComponentAt(k).remove(); return; }
            }
        } catch (e) {}
    }

    function isTF(m) { return m === "AE.ADBE Geometry" || m === "AE.ADBE Geometry2"; }

    /* cheap signature (name + param count). Only when the new effect lands among identical neighbours
       (e.g. a 2nd Transform) do we look deeper - and then only isTimeVarying(), which is cheap. */
    function compSig(clip) {
        var r = [], comps = clip.components;
        for (var i = 0; i < comps.numItems; i++) r.push(comps[i].matchName + "#" + comps[i].properties.numItems);
        return r;
    }
    function isFresh(c) {
        try {
            var n = Math.min(c.properties.numItems, 12);
            for (var j = 0; j < n; j++) { try { if (c.properties[j].isTimeVarying()) return false; } catch (e1) {} }
        } catch (e) {}
        return true;
    }
    function findNewComp(comps, before) {
        var after = compSig({ components: comps }), i;
        for (i = 0; i < before.length; i++) if (before[i] !== after[i]) break;
        /* block of identical signatures around the split point: the new one is in there */
        var sig = after[i], lo = i, hi = i;
        while (lo > 0 && after[lo - 1] === sig) lo--;
        while (hi + 1 < after.length && after[hi + 1] === sig) hi++;
        if (lo === hi) return i;
        var pick = -1;
        for (var k = hi; k >= lo; k--) if (isFresh(comps[k])) { pick = k; break; }
        return pick >= 0 ? pick : i;
    }

    /* Adds an effect through QE and returns the NEW component.
       QE inserts new effects at the top of the stack, so find it by diffing the component list. */
    function addVideoFxTo(seq, ref, info, qs, fxObj) {
        var clip = seq.videoTracks[ref.t].clips[ref.c];
        var before = compSig(clip);
        var cands = qeCandidates(qs.getVideoTrackAt(ref.t), ref.c, clip, info.tpf);
        if (!cands.length) { lastErr = "qe:V" + (ref.t + 1) + "#" + ref.c; return null; }
        var notes = [];
        for (var ci = 0; ci < cands.length && ci < 4; ci++) {
            var qi = cands[ci], qb = qeNames(qi);
            try { qi.addVideoEffect(fxObj); } catch (ae) { notes.push("add" + ci + ":" + ae); continue; }
            clip = seq.videoTracks[ref.t].clips[ref.c];
            var comps = clip.components;
            if (comps.numItems > before.length) {
                var ni = findNewComp(comps, before);
                if (ni >= 0 && ni < comps.numItems) { lastAdd = { qi: qi, idx: ni }; return comps[ni]; }
                lastAdd = { qi: qi, idx: comps.numItems - 1 };
                return comps[comps.numItems - 1];
            }
            notes.push("c" + ci + ":" + qi.name + "@" + qeTicks(qi) + " " + qb.length + ">" + qi.numComponents);
            undoOn(qi, qb);
        }
        lastErr = "nocomp:" + before.length + " start " + clip.start.ticks + " | " + notes.join(" ; ");
        return null;
    }

    function prmByName(comp, name, fxName) {
        var p = comp.properties;
        for (var i = 0; i < p.numItems; i++) if (p[i].displayName === name) return p[i];
        var map = PIDX[fxName];
        if (map && map[name] !== undefined && map[name] < p.numItems) return p[map[name]];
        return null;
    }

    /* one-line summary of what landed on a clip, for diag() */
    function report(ref, clip, tg) {
        try {
            var c = clip, cm = [];
            for (var i = 0; i < c.components.numItems; i++) cm.push(c.components[i].matchName.replace("AE.ADBE ", ""));
            var r = "V" + (ref.t + 1) + "#" + ref.c + " " + c.name + " in=" + c.inPoint.seconds.toFixed(2) + " st=" + c.start.seconds.toFixed(2) +
                " spd=" + (c.getSpeed ? c.getSpeed() : "?") + " comps=" + cm.join("/");
            if (tg) {
                var nm = ["scale", "pos", "rot", "op", "sw"];
                for (var j = 0; j < nm.length; j++) {
                    var k = null; try { k = tg[nm[j]].getKeys(); } catch (e) {}
                    if (k && k.length) r += " " + nm[j] + ":" + k.length + "@" + k[0].seconds.toFixed(2) + "~" + k[k.length - 1].seconds.toFixed(2);
                }
            }
            lastReport += r + " || ";
        } catch (e2) { lastReport += "report err " + e2 + " || "; }
    }

    function transformTargets(comp) {
        var p = comp.properties;
        return { anchor: p[0], pos: p[1], uni: p[2], scale: p[3], sw: p[4], rot: p[7], op: p[8], useComp: p[9], shutter: p[10], sampling: p[11] };
    }

    function setKeys(prm, keys) {
        if (!prm || !keys || !keys.length) return;
        try { prm.setTimeVarying(true); } catch (e) {}
        for (var i = 0; i < keys.length; i++) {
            var t = mkTime(keys[i][0]);
            prm.addKey(t);
            prm.setValueAtKey(t, keys[i][1], i === keys.length - 1 ? 1 : 0);
            try { prm.setInterpolationTypeAtKey(t, 0, i === keys.length - 1 ? 1 : 0); } catch (e2) {}
        }
    }

    /* repeat a [[f,...]] pattern of length P (frames) until F frames */
    function loopArr(arr, P, F) {
        if (!arr) return arr;
        var out = [];
        for (var r = 0; r * P <= F; r++) {
            for (var i = 0; i < arr.length; i++) {
                if (r > 0 && arr[i][0] === 0) continue;
                var f = arr[i][0] + r * P;
                if (f > F) break;
                var k = arr[i].slice(0); k[0] = f; out.push(k);
            }
        }
        return out;
    }

    /* p: see presets.js. Uses a NEW Transform effect for all motion; never touches Motion / Opacity. */
    /* fill-up helper: render each selected clip ALONE (other video tracks muted) to a PNG so the panel can find
       the rows the text occupies. Track mute states and the playhead are always restored. */
    function measureClips(o) {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var sel = selectedClips(seq);
        if (!sel.length) return "ERR|nosel";
        app.enableQE();
        var qs = qe.project.getActiveSequence();
        var info = seqInfo(seq);
        var dir = new Folder(Folder.temp.fsName + "/0202Transition"); if (!dir.exists) dir.create();
        var nT = seq.videoTracks.numTracks, prevMute = [], i, k;
        for (i = 0; i < nT; i++) { try { prevMute.push(seq.videoTracks[i].isMuted()); } catch (e0) { prevMute.push(false); } }
        var ph = seq.getPlayerPosition().ticks, out = [], stamp = new Date().getTime();
        try {
            for (k = 0; k < sel.length; k++) {
                var cl = sel[k].clip, cs = Number(cl.start.ticks), ce = Number(cl.end.ticks);
                var t = (o && o.anchor === "playhead" && Number(ph) >= cs && Number(ph) < ce) ? Number(ph) : cs + Math.round((ce - cs) / 2 / info.tpf) * info.tpf;
                for (i = 0; i < nT; i++) { try { seq.videoTracks[i].setMute(i === sel[k].t ? 0 : 1); } catch (e1) {} }
                seq.setPlayerPosition(String(t));
                var f = dir.fsName + "/band_" + stamp + "_" + k;
                var ok = false;
                try { ok = qs.exportFramePNG(qs.CTI.timecode, f); } catch (e2) { ok = false; }
                out.push(ok ? f + ".png" : "");
            }
        } finally {
            for (i = 0; i < nT; i++) { try { seq.videoTracks[i].setMute(prevMute[i] ? 1 : 0); } catch (e3) {} }
            try { seq.setPlayerPosition(String(ph)); } catch (e4) {}
        }
        return "OK|" + info.h + "|" + out.join(";");
    }

    /* wave fill needs original text + a matte copy BELOW the selected layer (Premiere hides the matte track).
       returns how many graphic/text clips overlap the selected clip on lower tracks */
    function matteLayers() {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var sel = selectedClips(seq);
        if (!sel.length) return "ERR|nosel";
        var worst = 99;
        for (var k = 0; k < sel.length; k++) {
            var cl = sel[k].clip, cs = Number(cl.start.ticks), ce = Number(cl.end.ticks), n = 0;
            for (var t = 0; t < sel[k].t; t++) {
                var tr = seq.videoTracks[t];
                for (var c = 0; c < tr.clips.numItems; c++) {
                    var o = tr.clips[c];
                    if (Number(o.end.ticks) <= cs || Number(o.start.ticks) >= ce) continue;
                    var gfx = false;
                    for (var j = 0; j < o.components.numItems; j++) { if (/Graphic Group|ADBE Text/.test(o.components[j].matchName)) { gfx = true; break; } }
                    if (gfx) n++;
                }
            }
            if (n < worst) worst = n;
        }
        return "OK|" + worst;
    }

    /* current composite frame at the playhead -> PNG (for picking a zoom centre in the panel) */
    function grabFrame() {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        app.enableQE();
        var qs = qe.project.getActiveSequence();
        var dir = new Folder(Folder.temp.fsName + "/0202Transition"); if (!dir.exists) dir.create();
        /* leftovers from earlier grabs / text-band measurements never pile up */
        try { var old = dir.getFiles(function (x) { return x instanceof File && /^(frame|band)_.*\.png$/.test(x.name); }); for (var j = 0; j < old.length; j++) { try { old[j].remove(); } catch (eR) {} } } catch (eL) {}
        var f = dir.fsName + "/frame_" + new Date().getTime();
        var ok = false;
        try { ok = qs.exportFramePNG(qs.CTI.timecode, f); } catch (e) { ok = false; }
        if (!ok) return "ERR|frame";
        return "OK|" + seq.frameSizeHorizontal + "|" + seq.frameSizeVertical + "|" + f + ".png";
    }
    function selCount() {
        var seq = app.project.activeSequence;
        if (!seq) return "OK|0";
        var n = 0;
        try { var g = seq.getSelection(); n = g ? g.length : 0; } catch (e) { n = selectedClips(seq).length; }
        return "OK|" + n;
    }
    /* selection changes are pushed to the panel (no polling). Premiere calls the bound handler,
       the handler sends a CSXS event "com.0202.sel" carrying the number of selected clips. */
    function watchSel() {
        try { if (!$.global.__T0202_pp) $.global.__T0202_pp = new ExternalObject("lib:PlugPlugExternalObject"); } catch (e) { return "ERR|plugplug"; }
        if (typeof app.bind !== "function") return "ERR|nobind";
        $.global.__T0202_selFire = function () {
            try { var ev = new CSXSEvent(); ev.type = "com.0202.sel"; ev.data = String(selCount()).split("|")[1]; ev.dispatch(); } catch (e) {}
        };
        if (!$.global.__T0202_selBound) {
            try {
                app.bind("onActiveSequenceSelectionChanged", function () { $.global.__T0202_selFire(); });
                app.bind("onActiveSequenceChanged", function () { $.global.__T0202_selFire(); });
            } catch (e2) { return "ERR|bind"; }
            $.global.__T0202_selBound = true;
        }
        return "OK";
    }
    function tfKeyed(t) {
        var ks = [t.anchor, t.pos, t.scale, t.sw, t.rot, t.op];
        for (var i = 0; i < ks.length; i++) { try { if (ks[i] && ks[i].isTimeVarying()) return true; } catch (e) {} }
        return false;
    }
    function samePt(a, b) { try { return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4; } catch (e) { return false; } }
    /* a "centre" Transform = un-keyed Transform whose anchor equals its position (left by the centre picker) */
    function findCentreTF(clip) {
        var comps = clip.components;
        for (var i = 0; i < comps.numItems; i++) {
            var c = comps[i];
            if (!isTF(c.matchName)) continue;
            var t = transformTargets(c);
            if (tfKeyed(t)) continue;
            var av = null, pv = null;
            try { av = t.anchor.getValue(); pv = t.pos.getValue(); } catch (e) {}
            var sc = 100, ro = 0, op = 100;
            try { sc = Number(t.scale.getValue()); ro = Number(t.rot.getValue()); op = Number(t.op.getValue()); } catch (e2) {}
            /* only a pure centre (no scale / rotation / fade of its own), so e.g. a punch-cut Transform is never reused */
            if (av && pv && samePt(av, pv) && Math.abs(sc - 100) < 0.01 && Math.abs(ro) < 0.01 && Math.abs(op - 100) < 0.01) return c;
        }
        return null;
    }
    /* centre picker: zooms already on the clip move to the point; a clip without a zoom gets a centre Transform
       that the next zoom / quick zoom reuses (its keys are written into it) */
    /* anchor of the first Transform (other than `skip`) that was moved off the clip centre by the picker */
    function pickedCentre(clip, skip) {
        var comps = clip.components;
        for (var i = 0; i < comps.numItems; i++) {
            var c = comps[i];
            if (!isTF(c.matchName)) continue;
            if (skip && c.properties.numItems && skip.properties.numItems && c === skip) continue;
            try {
                var av = transformTargets(c).anchor.getValue();
                if (Math.abs(Number(av[0]) - 0.5) > 1e-4 || Math.abs(Number(av[1]) - 0.5) > 1e-4) return [Number(av[0]), Number(av[1])];
            } catch (e) {}
        }
        return null;
    }
    /* frame size of the clip's own media (a nested sequence's frame, or the footage's video size) */
    function clipSrcSize(clip, info) {
        var pi = null;
        try { pi = clip.projectItem; } catch (e0) {}
        if (pi) {
            try {
                var seqs = app.project.sequences;
                for (var i = 0; i < seqs.numSequences; i++) {
                    var sq = seqs[i];
                    if (sq.projectItem && sq.projectItem.nodeId === pi.nodeId) return [Number(sq.frameSizeHorizontal), Number(sq.frameSizeVertical)];
                }
            } catch (e1) {}
            try {
                var md = String(pi.getProjectMetadata());
                var m = md.match(/VideoInfo>\s*(\d+)\s*x\s*(\d+)/);
                if (m) return [Number(m[1]), Number(m[2])];
            } catch (e2) {}
        }
        return [info.w, info.h]; /* graphics etc: same as the sequence */
    }
    /* the picker works on the SEQUENCE frame; Transform (an effect) works on the clip's SOURCE frame before Motion.
       invert Motion (position / scale / anchor) so the picked spot on screen is where the clip really pivots.
       returns a normalized point in source space, snapped to a whole source pixel. */
    function seqToSource(clip, info, pt) {
        var src = clipSrcSize(clip, info), sw = src[0], sh = src[1];
        var mp = [0.5, 0.5], ma = [0.5, 0.5], sx = 1, sy = 1;
        try {
            var comps = clip.components;
            for (var i = 0; i < comps.numItems; i++) {
                if (comps[i].matchName !== "AE.ADBE Motion") continue;
                var pr = comps[i].properties;
                var pv = pr[0].getValue(), sc = Number(pr[1].getValue()) / 100, scw = Number(pr[2].getValue()) / 100, uni = !!pr[3].getValue(), av = pr[5].getValue();
                mp = [Number(pv[0]), Number(pv[1])]; ma = [Number(av[0]), Number(av[1])];
                sy = sc || 1; sx = uni ? sy : (scw || 1);
                break;
            }
        } catch (e) {}
        var seqX = pt[0] * info.w, seqY = pt[1] * info.h;
        var srcX = ma[0] * sw + (seqX - mp[0] * info.w) / sx;
        var srcY = ma[1] * sh + (seqY - mp[1] * info.h) / sy;
        srcX = Math.round(srcX); srcY = Math.round(srcY);
        return [srcX / sw, srcY / sh];
    }
    /* original basis: the picked point is used as-is in the clip's own frame, snapped to a whole pixel */
    function snapSrc(clip, info, pt) {
        var src = clipSrcSize(clip, info), sw = src[0], sh = src[1];
        return [Math.round(pt[0] * sw) / sw, Math.round(pt[1] * sh) / sh];
    }
    /* off-centre pivot: Transform rounds its move to whole pixels each frame, which reads as shaking.
       Transform's own shutter (180) averages those steps out (measured: 0.6px jumps -> under 0.02px).
       Only switched on when the clip has no blur set, so a user's blur setting is kept. */
    function bicubic(t) {
        try { if (t.sampling) t.sampling.setValue(1, 1); } catch (e) {}
        try {
            var uc = t.useComp ? t.useComp.getValue() : false, sh = t.shutter ? Number(t.shutter.getValue()) : 0;
            if (uc || !sh) { t.useComp.setValue(false, 1); t.shutter.setValue(180, 1); }
        } catch (e2) {}
    }
    function shiftPos(pr, dx, dy) {
        var keyed = false;
        try { keyed = pr.isTimeVarying(); } catch (e) {}
        if (!keyed) { var v = pr.getValue(); pr.setValue([Number(v[0]) + dx, Number(v[1]) + dy], 1); return; }
        var ks = pr.getKeys() || [];
        for (var i = 0; i < ks.length; i++) {
            var kv = pr.getValueAtKey(ks[i]);
            pr.setValueAtKey(ks[i], [Number(kv[0]) + dx, Number(kv[1]) + dy], 1);
        }
    }
    /* centre picker: every Transform on the selected clips pivots around the point (anchor -> point, position shifted
       by the same amount so motion paths are kept). A clip with no Transform gets a centre Transform that the next
       preset writes into. */
    function setZoomAt(o) {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var sel = selectedClips(seq);
        if (!sel.length) return "ERR|nosel";
        var info = seqInfo(seq), qs = null;
        try { app.enableQE(); qs = qe.project.getActiveSequence(); } catch (eq) {}
        var moved = 0, made = 0;
        for (var k = 0; k < sel.length; k++) {
            var clip = seq.videoTracks[sel[k].t].clips[sel[k].c], comps = clip.components, hit = 0;
            var pt = snapSrc(clip, info, [o.x, o.y]);
            for (var i = 0; i < comps.numItems; i++) {
                var c = comps[i];
                if (!isTF(c.matchName)) continue;
                var t = transformTargets(c);
                try {
                    var a0 = t.anchor.getValue(), dx = pt[0] - Number(a0[0]), dy = pt[1] - Number(a0[1]);
                    t.anchor.setValue(pt, 1);
                    shiftPos(t.pos, dx, dy);
                    bicubic(t);
                    hit++;
                } catch (e3) {}
            }
            if (hit) { moved += hit; continue; }
            var cen = null;
            if (qs) { try { cen = addFxVerified(seq, sel[k], info, qs, "Transform"); } catch (e4) { cen = null; } }
            if (cen && isTF(cen.matchName)) {
                var tt = transformTargets(cen);
                try { tt.anchor.setValue(pt, 1); tt.pos.setValue(pt, 1); bicubic(tt); made++; } catch (e5) {}
            }
        }
        return "OK|" + moved + "|" + made;
    }

    function applyPreset(p) {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var info = seqInfo(seq);
        var sel = selectedClips(seq);
        if (!sel.length) return "ERR|nosel";
        var qs = null;
        try { app.enableQE(); qs = qe.project.getActiveSequence(); } catch (e) {}
        if (!qs) return "ERR|notf|noqe";
        var needTF = !!(p.type === "rate" || p.scale || p.pos || p.rot || p.op || p.sw || p.sh || p.sScale);
        var ph = Number(seq.getPlayerPosition().ticks);
        var fpsK = info.fps / 30;
        var pxK = Math.min(info.w, info.h) / 1080;
        var done = 0, failed = 0, info2 = "", missing = {}, fitted = 0;
        lastReport = "";

        for (var s = 0; s < sel.length; s++) {
            var ref = sel[s];
            var clip = ref.clip;
            var cs = Number(clip.start.ticks), ce = Number(clip.end.ticks), cin = Number(clip.inPoint.ticks);
            var startT = (p.anchor === "playhead" && ph >= cs && ph < ce) ? ph : cs;
            startT = cs + Math.round((startT - cs) / info.tpf) * info.tpf;
            var endT = ce - info.tpf;
            if (endT <= startT) endT = startT + info.tpf;
            /* effect keyframes live in media time: on a speed-changed clip one sequence frame covers `spd` media frames */
            var spd = 1;
            try { spd = Math.abs(Number(clip.getSpeed())) || 1; } catch (eSp) { spd = 1; }
            var src = function (seqT) { return cin + (seqT - cs) * spd; };

            /* extra effects first (QE puts new ones on top, so Transform added last ends up on top) */
            var fxl = p.fx || [];
            for (var x = 0; x < fxl.length; x++) {
                var fc = null;
                try { fc = addFxVerified(seq, ref, info, qs, fxl[x].fx); } catch (ex) { fc = null; }
                if (!fc) { missing[fxl[x].fx] = 1; continue; }
                fxl[x]._comp = fc;
            }

            var tg = null, cx = 0.5, cy = 0.5;
            if (needTF) {
                var comp = null;
                /* zoom / quick zoom: write into the centre Transform left by the picker, keeping its centre */
                /* a centre Transform left by the picker is reused by ANY Transform preset, keeping its centre */
                var cenUsed = null;
                if (p.centre) { try { cenUsed = findCentreTF(seq.videoTracks[ref.t].clips[ref.c]); } catch (eC) { cenUsed = null; } }
                comp = cenUsed;
                if (!comp) { try { comp = addFxVerified(seq, ref, info, qs, "Transform"); } catch (e3) { comp = null; } }
                if (!comp || !isTF(comp.matchName)) { failed++; continue; }
                tg = transformTargets(comp);
                cx = 0.5; cy = 0.5;
                if (cenUsed) { try { var av0 = tg.anchor.getValue(); cx = Number(av0[0]); cy = Number(av0[1]); } catch (eAv) {} }
                else {
                    /* new Transform on a clip whose other Transforms were re-centred: pivot around the same point */
                    var cc = p.centre ? pickedCentre(seq.videoTracks[ref.t].clips[ref.c], comp) : null;
                    if (cc) { cx = cc[0]; cy = cc[1]; try { tg.anchor.setValue([cx, cy], 1); tg.pos.setValue([cx, cy], 1); } catch (eCc) {} }
                }
                if (Math.abs(cx - 0.5) > 1e-4 || Math.abs(cy - 0.5) > 1e-4) bicubic(tg);
            }

            if (p.type === "rate") {
                var sec = (endT - startT) / TPS;
                var big = Math.round(Math.min(100 + p.rate * sec, p.max || 200) * 100) / 100;
                var v0 = p.dir > 0 ? 100 : big, v1 = p.dir > 0 ? big : 100;
                try { tg.uni.setValue(true, 1); } catch (e6) {}
                setKeys(tg.scale, [[src(startT), v0], [src(endT), v1]]);
                info2 = v0 + "-" + v1;
                report(ref, seq.videoTracks[ref.t].clips[ref.c], tg);
                done++;
                continue;
            }

            /* time mapping */
            var A = { scale: p.scale, pos: p.pos, rot: p.rot, op: p.op, sw: p.sw, sh: p.sh };
            var fxKeys = [];
            for (x = 0; x < fxl.length; x++) {
                var ks = fxl[x].keys || [];
                for (var y = 0; y < ks.length; y++) {
                    var arrK = ks[y][1];
                    /* text-band fill: map Crop Top 100..0 onto this clip's text rows (bottom..top, in %) */
                    if (p.bands && p.bands[s] && fxl[x].fx === "Crop" && ks[y][0] === "Top") {
                        var bTop = p.bands[s][0], bBot = p.bands[s][1], mk = [];
                        for (var z = 0; z < arrK.length; z++) mk.push([arrK[z][0], Math.round((bTop + (arrK[z][1] / 100) * (bBot - bTop)) * 100) / 100]);
                        arrK = mk;
                    }
                    fxKeys.push({ x: x, name: ks[y][0], arr: arrK });
                }
            }
            var toSeq, nm;
            if (p.type === "span") {
                var spanF = (endT - startT) / info.tpf;
                toSeq = function (f) { return startT + Math.round(f * spanF) * info.tpf; };
            } else {
                if (p.type === "loop" && p.period > 0) {
                    var F = ((endT - startT) / info.tpf) / fpsK;
                    for (nm in A) A[nm] = loopArr(A[nm], p.period, F);
                    for (y = 0; y < fxKeys.length; y++) fxKeys[y].arr = loopArr(fxKeys[y].arr, p.period, F);
                }
                var lastF = 0;
                for (nm in A) if (A[nm] && A[nm].length) lastF = Math.max(lastF, A[nm][A[nm].length - 1][0]);
                for (y = 0; y < fxKeys.length; y++) if (fxKeys[y].arr.length) lastF = Math.max(lastF, fxKeys[y].arr[fxKeys[y].arr.length - 1][0]);
                var base = startT, fit = 1;
                if (p.type === "out") {
                    base = ce - info.tpf - Math.round(lastF * fpsK) * info.tpf;
                    if (base < cs) base = cs;
                }
                /* clip (or the part after the start point) is shorter than the move: squeeze it to fit */
                var availF = (endT - base) / info.tpf, needF = lastF * fpsK;
                if (p.type !== "loop" && !p.noFit && needF > availF && needF > 0 && availF > 0) { fit = availF / needF; fitted++; }
                toSeq = function (f) { return base + Math.round(f * fpsK * fit) * info.tpf; };
            }
            /* repeating keys (e.g. a twinkle) from lfrom to the clip end; never part of the fit/squeeze above */
            if (p.type !== "span") {
                var Fend = ((endT - startT) / info.tpf) / (fpsK * (fit || 1));
                for (x = 0; x < fxl.length; x++) {
                    var lk = fxl[x].lkeys || [], lp = Number(fxl[x].lper) || 0, l0 = Number(fxl[x].lfrom) || 0;
                    if (!lk.length || lp <= 0) continue;
                    for (y = 0; y < lk.length; y++) {
                        var cyc = loopArr(lk[y][1], lp, Fend - l0), gen = [];
                        for (var g2 = 0; g2 < cyc.length; g2++) gen.push([cyc[g2][0] + l0, cyc[g2][1]]);
                        var hitK = -1;
                        for (var q2 = 0; q2 < fxKeys.length; q2++) if (fxKeys[q2].x === x && fxKeys[q2].name === lk[y][0]) hitK = q2;
                        if (hitK < 0) fxKeys.push({ x: x, name: lk[y][0], arr: gen });
                        else {
                            var pre = [];
                            for (var q3 = 0; q3 < fxKeys[hitK].arr.length; q3++) if (fxKeys[hitK].arr[q3][0] < l0) pre.push(fxKeys[hitK].arr[q3]);
                            fxKeys[hitK].arr = pre.concat(gen);
                        }
                    }
                }
            }
            var conv = function (arr, fn) {
                var out = [], seen = {};
                if (!arr) return out;
                for (var i = 0; i < arr.length; i++) {
                    var tk = src(toSeq(arr[i][0]));
                    if (tk > src(ce) - 1) continue;
                    var v = fn(arr[i]);
                    if (seen[tk] !== undefined) { out[seen[tk]][1] = v; continue; }
                    seen[tk] = out.length;
                    out.push([tk, v]);
                }
                return out;
            };
            var num = function (k) { return k[1]; };
            var posFn = function (k) {
                /* offsets are relative to the clip centre - or to the picked centre (anchor = position = that point) */
                if (p.posToY) return [cx + (k[1] * pxK) / info.w, cy + k[2] * (p.posToY / info.h - 0.5)];
                return [cx + (k[1] * pxK) / info.w, cy + (k[2] * pxK) / info.h];
            };

            if (tg) {
                var nonUni = !!(A.sw || A.sh);
                try { tg.uni.setValue(!nonUni, 1); } catch (e6b) {}
                if (p.sScale && !A.scale && !nonUni) tg.scale.setValue(p.sScale, 1);
                if (nonUni) {
                    setKeys(tg.scale, conv(A.sh || A.scale, num));
                    setKeys(tg.sw, conv(A.sw || A.scale, num));
                } else {
                    setKeys(tg.scale, conv(A.scale, num));
                }
                if (p.shutter) {
                    try { tg.useComp.setValue(false, 1); } catch (e7) {}
                    try { tg.shutter.setValue(p.shutter, 1); } catch (e8) {}
                }
                setKeys(tg.pos, conv(A.pos, posFn));
                setKeys(tg.rot, conv(A.rot, num));
                setKeys(tg.op, conv(A.op, num));
            }

            for (x = 0; x < fxl.length; x++) {
                var c2 = fxl[x]._comp;
                if (!c2) continue;
                var st = fxl[x].set || [];
                for (y = 0; y < st.length; y++) {
                    var pr = prmByName(c2, st[y][0], fxl[x].fx);
                    var sv = st[y][1];
                    if (sv === "$BELOW") sv = ref.t; /* Track Matte "Matte" popup: Video N = track index + 1, so the track below = ref.t */
                    if (pr) { try { pr.setValue(sv, 1); } catch (e9) {} } else missing[fxl[x].fx + ":" + st[y][0]] = 1;
                }
            }
            for (y = 0; y < fxKeys.length; y++) {
                var c3 = fxl[fxKeys[y].x]._comp;
                if (!c3) continue;
                var pr2 = prmByName(c3, fxKeys[y].name, fxl[fxKeys[y].x].fx);
                if (pr2) setKeys(pr2, conv(fxKeys[y].arr, num)); else missing[fxl[fxKeys[y].x].fx + ":" + fxKeys[y].name] = 1;
            }
            /* colour params: [name, [r,g,b]] */
            for (x = 0; x < fxl.length; x++) {
                var c5 = fxl[x]._comp, cl5 = fxl[x].color || [];
                if (!c5) continue;
                for (y = 0; y < cl5.length; y++) {
                    var pr5 = prmByName(c5, cl5[y][0], fxl[x].fx);
                    if (!pr5) { missing[fxl[x].fx + ":" + cl5[y][0]] = 1; continue; }
                    try { pr5.setColorValue(255, cl5[y][1][0], cl5[y][1][1], cl5[y][1][2], 1); } catch (e10) { missing[fxl[x].fx + ":" + cl5[y][0] + "(color)"] = 1; }
                }
            }
            /* rate keys: value grows linearly per second from start point to clip end */
            for (x = 0; x < fxl.length; x++) {
                var c4 = fxl[x]._comp, rt = fxl[x].rate || [];
                if (!c4) continue;
                for (y = 0; y < rt.length; y++) {
                    var pr3 = prmByName(c4, rt[y][0], fxl[x].fx);
                    if (!pr3) { missing[fxl[x].fx + ":" + rt[y][0]] = 1; continue; }
                    setKeys(pr3, [[src(startT), 0], [src(endT), Math.round(rt[y][1] * (endT - startT) / TPS * 100) / 100]]);
                }
            }
            for (x = 0; x < fxl.length; x++) fxl[x]._comp = null;
            report(ref, seq.videoTracks[ref.t].clips[ref.c], tg);
            done++;
        }
        var miss = [];
        for (var mk in missing) miss.push(mk);
        if (!done && failed) return "ERR|notf|" + lastErr;
        return "OK|" + done + "|" + failed + "|" + info2 + "|" + miss.join(",") + "|" + fitted;
    }

    /* ---------- favourite effects ---------- */
    function listEffects() {
        try { app.enableQE(); } catch (e) {}
        var v = [], a = [];
        try { v = splitList(qe.project.getVideoEffectList()); } catch (e1) {}
        try { a = splitList(qe.project.getAudioEffectList()); } catch (e2) {}
        var vt = [], at = [];
        try { vt = splitList(qe.project.getVideoTransitionList()); } catch (e3) {}
        try { at = splitList(qe.project.getAudioTransitionList()); } catch (e4) {}
        return "OK|" + v.join("\t") + "|" + a.join("\t") + "|" + vt.join("\t") + "|" + at.join("\t");
    }
    /* transition at the cut nearest the playhead inside each selected clip (start or end), 1 second, centered */
    function addTransition(o) {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var info = seqInfo(seq);
        try { app.enableQE(); } catch (e) {}
        var qs = qe.project.getActiveSequence();
        var au = o.k === "at";
        var sel = au ? selectedAudio(seq) : selectedClips(seq);
        if (!sel.length) return au ? "ERR|noasel" : "ERR|nosel";
        var tr = null;
        try { tr = au ? qe.project.getAudioTransitionByName(o.n) : qe.project.getVideoTransitionByName(o.n); } catch (e1) {}
        if (!tr) return "ERR|nofx";
        var ph = Number(seq.getPlayerPosition().ticks);
        var fps = Math.round(info.fps);
        var dur = "00:00:01:00", off = "00:00:00:00";
        var n = 0, errs = [];
        for (var s = 0; s < sel.length; s++) {
            var clip = sel[s].clip, cs = Number(clip.start.ticks), ce = Number(clip.end.ticks);
            var atStart = Math.abs(ph - cs) <= Math.abs(ph - ce);
            var qi = null;
            try { qi = qeItemFor(au ? qs.getAudioTrackAt(sel[s].t) : qs.getVideoTrackAt(sel[s].t), sel[s].c, clip, info.tpf); } catch (e2) {}
            if (!qi) { errs.push("qe"); continue; }
            var ok = false;
            try { qi.addTransition(tr, atStart, dur, off, 0.5, false, true); ok = true; } catch (e3) { errs.push(String(e3)); }
            if (!ok) { try { qi.addTransition(tr, atStart); ok = true; } catch (e4) { errs.push(String(e4)); } }
            if (ok) n++;
        }
        if (!n && errs.length) lastErr = "transition: " + errs.join(" ; ");
        return "OK|" + n;
    }

    /* o: {n: name, a: 1 for audio} */
    function addEffect(o) {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var info = seqInfo(seq);
        try { app.enableQE(); } catch (e) {}
        var qs = qe.project.getActiveSequence();
        var sel = o.a ? selectedAudio(seq) : selectedClips(seq);
        if (!sel.length) return o.a ? "ERR|noasel" : "ERR|nosel";
        var fx = o.a ? getAudioFx(o.n) : getVideoFx(o.n);
        if (!fx) return "ERR|nofx";
        var n = 0;
        for (var s = 0; s < sel.length; s++) {
            try {
                if (o.a) {
                    var qi = qeItemFor(qs.getAudioTrackAt(sel[s].t), sel[s].c, sel[s].clip, info.tpf);
                    if (qi) { qi.addAudioEffect(fx); n++; }
                } else {
                    if (addVideoFxTo(seq, sel[s], info, qs, fx)) n++;
                }
            } catch (e2) {}
        }
        return "OK|" + n;
    }

    /* ---------- custom curve baking ---------- */
    function bez(x1, y1, x2, y2, x) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        var lo = 0, hi = 1, t = x;
        for (var i = 0; i < 40; i++) {
            t = (lo + hi) / 2;
            var cx = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
            if (cx < x) lo = t; else hi = t;
        }
        return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
    }

    function classify(match, pi) {
        if (match === "AE.ADBE Motion") return pi === 0 ? "pos" : (pi === 1 || pi === 2) ? "scale" : pi === 4 ? "rot" : "other";
        if (match === "AE.ADBE Opacity") return pi === 0 ? "op" : "skip";
        if (isTF(match)) return pi === 1 ? "pos" : (pi === 3 || pi === 4) ? "scale" : pi === 7 ? "rot" : pi === 8 ? "op" : "other";
        return "other";
    }

    function lerp(a, b, e) {
        if (typeof a === "number" && typeof b === "number") return a + (b - a) * e;
        if (a && b && a.length !== undefined && a.length === b.length) {
            var r = [];
            for (var i = 0; i < a.length; i++) {
                if (typeof a[i] !== "number") return null;
                r.push(a[i] + (b[i] - a[i]) * e);
            }
            return r;
        }
        return null;
    }

    function same(a, b) {
        if (typeof a === "number") return a === b;
        if (a && b && a.length !== undefined) {
            for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
            return true;
        }
        return true;
    }

    function readKeys(prm) {
        var ks = prm.getKeys(), out = [];
        if (!ks) return out;
        for (var i = 0; i < ks.length; i++) {
            var tk = Number(ks[i].ticks);
            out.push([tk, prm.getValueAtKey(ks[i])]);
        }
        out.sort(function (x, y) { return x[0] - y[0]; });
        return out;
    }

    function restoreParam(prm, sn) {
        var keep = {};
        for (var i = 0; i < sn.orig.length; i++) keep[sn.orig[i][0]] = true;
        var cur = readKeys(prm);
        for (var j = 0; j < cur.length; j++) {
            if (!keep[cur[j][0]]) prm.removeKey(mkTime(cur[j][0]));
        }
        for (var k = 0; k < sn.orig.length; k++) {
            prm.setValueAtKey(mkTime(sn.orig[k][0]), sn.orig[k][1], k === sn.orig.length - 1 ? 1 : 0);
        }
    }

    /* o: {x1,y1,x2,y2, props:{pos,scale,rot,op,other}, scope:'all'|'playhead', step} */
    function applyCurve(o) {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var info = seqInfo(seq);
        var sel = selectedClips(seq);
        if (!sel.length) return "ERR|nosel";
        var ph = Number(seq.getPlayerPosition().ticks);
        var step = Math.max(1, o.step || 1) * info.tpf;
        var clipsDone = 0, segs = 0;

        for (var s = 0; s < sel.length; s++) {
            var clip = sel[s].clip;
            var cs = Number(clip.start.ticks), cin = Number(clip.inPoint.ticks);
            var phSrc = cin + (ph - cs);
            var touched = false;
            var comps = clip.components;
            for (var ci = 0; ci < comps.numItems; ci++) {
                var comp = comps[ci];
                var props = comp.properties;
                for (var pi = 0; pi < props.numItems; pi++) {
                    var cat = classify(comp.matchName, pi);
                    if (cat === "skip" || !o.props[cat]) continue;
                    var prm = props[pi];
                    var tv = false;
                    try { tv = prm.isTimeVarying(); } catch (e) {}
                    if (!tv) continue;
                    var key = clip.nodeId + "|" + ci + "|" + pi;
                    var cur = readKeys(prm);
                    if (cur.length < 2) continue;
                    var sn = snaps[key];
                    if (sn && cur.length === sn.baked) {
                        restoreParam(prm, sn);
                        cur = readKeys(prm);
                    } else {
                        sn = { orig: cur };
                        snaps[key] = sn;
                    }
                    var anchors = sn.orig;
                    for (var k = 0; k < anchors.length - 1; k++) {
                        var k0 = anchors[k][0], k1 = anchors[k + 1][0];
                        var v0 = anchors[k][1], v1 = anchors[k + 1][1];
                        if (o.scope === "playhead" && !(phSrc >= k0 && phSrc <= k1)) continue;
                        if (typeof v0 === "boolean" || same(v0, v1)) continue;
                        if (lerp(v0, v1, 0.5) === null) continue;
                        var len = k1 - k0;
                        for (var tk = k0 + step; tk < k1 - info.tpf / 2; tk += step) {
                            var t = mkTime(tk);
                            prm.addKey(t);
                            prm.setValueAtKey(t, lerp(v0, v1, bez(o.x1, o.y1, o.x2, o.y2, (tk - k0) / len)), 0);
                        }
                        segs++;
                        touched = true;
                    }
                    sn.baked = prm.getKeys() ? prm.getKeys().length : 0;
                    try { prm.setValueAtKey(mkTime(anchors[anchors.length - 1][0]), anchors[anchors.length - 1][1], 1); } catch (e2) {}
                }
            }
            if (touched) clipsDone++;
        }
        return "OK|" + clipsDone + "|" + segs;
    }

    function restoreCurve() {
        var seq = app.project.activeSequence;
        if (!seq) return "ERR|noseq";
        var sel = selectedClips(seq);
        if (!sel.length) return "ERR|nosel";
        var n = 0;
        for (var s = 0; s < sel.length; s++) {
            var clip = sel[s].clip;
            var comps = clip.components;
            for (var ci = 0; ci < comps.numItems; ci++) {
                var props = comps[ci].properties;
                for (var pi = 0; pi < props.numItems; pi++) {
                    var key = clip.nodeId + "|" + ci + "|" + pi;
                    if (!snaps[key]) continue;
                    try { restoreParam(props[pi], snaps[key]); n++; } catch (e) {}
                    delete snaps[key];
                }
            }
        }
        return "OK|" + n;
    }

    /* diagnostic dump for remote troubleshooting */
    function diag() {
        var o = [];
        try { o.push("Premiere " + app.version + " build " + app.build); } catch (e) {}
        try { o.push("locale " + $.locale + " / os " + $.os); } catch (e1) {}
        o.push("lastErr " + lastErr);
        o.push("last " + lastReport);
        try {
            app.enableQE();
            var list = splitList(qe.project.getVideoEffectList()), hit = [];
            for (var i = 0; i < list.length; i++) if (/trans|geometr|\uBCC0\uD615|\uBCC0\uD658/i.test(list[i])) hit.push(list[i]);
            o.push("fx(" + list.length + "): " + hit.join(" / "));
            var t1 = null; try { t1 = qe.project.getVideoEffectByName("Transform"); } catch (e2) {}
            o.push("byName(Transform) " + (t1 ? "ok" : "null"));
        } catch (e3) { o.push("qe err " + e3); }
        try {
            var seq = app.project.activeSequence;
            o.push("seq " + seq.name + " " + seq.frameSizeHorizontal + "x" + seq.frameSizeVertical);
            var sel = selectedClips(seq), qs = qe.project.getActiveSequence();
            for (var s = 0; s < sel.length && s < 3; s++) {
                var cl = sel[s].clip, cm = [];
                for (var k = 0; k < cl.components.numItems; k++) cm.push(cl.components[k].matchName);
                o.push("sel V" + (sel[s].t + 1) + "#" + sel[s].c + " " + cl.name + " start " + cl.start.ticks + " | " + cm.join(","));
                var qt = qs.getVideoTrackAt(sel[s].t), it = [];
                for (var q = 0; q < qt.numItems && q < 12; q++) { var x = qt.getItemAt(q); it.push(x.type + ":" + x.name + "@" + qeTicks(x)); }
                o.push("  qe " + it.join(" ; "));
            }
        } catch (e4) { o.push("seq err " + e4); }
        return o.join("\n");
    }

    function ping() { return "OK|" + app.version; }

    /* never let an exception escape as a bare "EvalScript error": report line + message instead */
    function safe(fn, name) {
        return function (a) {
            try { return fn(a); }
            catch (e) { lastErr = name + " L" + e.line + " " + e.message; return "ERR|ex|" + name + " L" + e.line + " " + e.message; }
        };
    }
    return { applyPreset: safe(applyPreset, "applyPreset"), applyCurve: safe(applyCurve, "applyCurve"), restoreCurve: safe(restoreCurve, "restoreCurve"),
        listEffects: safe(listEffects, "listEffects"), addEffect: safe(addEffect, "addEffect"), addTransition: safe(addTransition, "addTransition"), measureClips: safe(measureClips, "measureClips"), matteLayers: safe(matteLayers, "matteLayers"), grabFrame: safe(grabFrame, "grabFrame"), setZoomAt: safe(setZoomAt, "setZoomAt"), selCount: safe(selCount, "selCount"), watchSel: safe(watchSel, "watchSel"), diag: safe(diag, "diag"), ping: safe(ping, "ping") };
})();
