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
        "ProcAmp": ["ProcAmp"],
        "Crop": ["Crop", "\uC790\uB974\uAE30"]
    };

    /* parameter index fallback when display names are localized */
    var PIDX = {
        "Turbulent Displace": { "Amount": 1, "Size": 2, "Offset (Turbulence)": 3, "Complexity": 4, "Evolution": 5, "Cycle Evolution": 7, "Cycle (in Revolutions)": 8, "Random Seed": 9 },
        "Posterize Time": { "Frame Rate": 0 },
        "Wave Warp": { "Wave Height": 1, "Wave Width": 2, "Direction": 3, "Wave Speed": 4, "Pinning": 5, "Phase": 6 },
        "Tint": { "Map Black To": 0, "Map White To": 1, "Amount to Tint": 2 },
        "Brightness & Contrast": { "Brightness": 0, "Contrast": 1 },
        "Gaussian Blur": { "Blurriness": 0 },
        "ProcAmp": { "Brightness": 0, "Contrast": 1, "Hue": 2, "Saturation": 3 },
        "Crop": { "Left": 0, "Top": 1, "Right": 2, "Bottom": 3, "Zoom": 4, "Edge Feather": 5 }
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
        "ProcAmp": [/procamp/i],
        "Crop": [/^crop$/i, /^\uC790\uB974\uAE30$/]
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
        "Crop": /Crop/i
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

    /* signature of every component on the clip. matchName alone is not enough: a second Transform added next to the
       first one has the same name and param count, so the diff used to hand back the OLD Transform and the new keys
       overwrote the previous effect. Include keyframe counts / values so an untouched new effect always differs. */
    function compSig(clip) {
        var r = [], comps = clip.components;
        for (var i = 0; i < comps.numItems; i++) {
            var c = comps[i], sig = c.matchName + "#" + c.properties.numItems;
            try {
                var n = Math.min(c.properties.numItems, 12);
                for (var j = 0; j < n; j++) {
                    var pr = c.properties[j], t = "";
                    try { if (pr.isTimeVarying()) { var ks = pr.getKeys(); t = "k" + (ks ? ks.length : 0) + ":" + (ks && ks.length ? ks[0].ticks : ""); } } catch (e1) {}
                    if (!t) { try { var v = pr.getValue(); t = (typeof v === "number") ? String(Math.round(v * 1000) / 1000) : String(v); } catch (e2) { t = "?"; } }
                    sig += "|" + t;
                }
            } catch (e) {}
            r.push(sig);
        }
        return r;
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
                var after = compSig(clip);
                for (var i = 0; i < comps.numItems; i++) {
                    if (i >= before.length || before[i] !== after[i]) { lastAdd = { qi: qi, idx: i }; return comps[i]; }
                }
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
        return { pos: p[1], uni: p[2], scale: p[3], sw: p[4], rot: p[7], op: p[8], useComp: p[9], shutter: p[10] };
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

            var tg = null;
            if (needTF) {
                var comp = null;
                try { comp = addFxVerified(seq, ref, info, qs, "Transform"); } catch (e3) { comp = null; }
                if (!comp || !isTF(comp.matchName)) { failed++; continue; }
                tg = transformTargets(comp);
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
                for (var y = 0; y < ks.length; y++) fxKeys.push({ x: x, name: ks[y][0], arr: ks[y][1] });
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
                if (p.type !== "loop" && needF > availF && needF > 0 && availF > 0) { fit = availF / needF; fitted++; }
                toSeq = function (f) { return base + Math.round(f * fpsK * fit) * info.tpf; };
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
                if (p.posToY) return [0.5 + (k[1] * pxK) / info.w, 0.5 + k[2] * (p.posToY / info.h - 0.5)];
                return [0.5 + (k[1] * pxK) / info.w, 0.5 + (k[2] * pxK) / info.h];
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
                    if (pr) { try { pr.setValue(st[y][1], 1); } catch (e9) {} } else missing[fxl[x].fx + ":" + st[y][0]] = 1;
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
        listEffects: safe(listEffects, "listEffects"), addEffect: safe(addEffect, "addEffect"), addTransition: safe(addTransition, "addTransition"), diag: safe(diag, "diag"), ping: safe(ping, "ping") };
})();
