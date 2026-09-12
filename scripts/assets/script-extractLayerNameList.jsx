#target illustrator

/**
 * extractLayerNameList.jsx
 *
 * Reads the current selection in the active Illustrator document. When a group
 * is selected, writes the group's name as a header line, then walks every item
 * nested inside it (recursing through nested groups) and writes each item's
 * name to layerNames.txt, indented two spaces per nesting level so the output
 * mirrors the group hierarchy.
 *
 * The output file is written next to the active document when it has been
 * saved, otherwise it falls back to the Desktop.
 */

function main() {
    if (app.documents.length === 0) {
        alert("Open a document and select a group before running this script.");
        return;
    }

    var doc = app.activeDocument;
    var sel = doc.selection;

    if (!sel || sel.length === 0) {
        alert("Nothing is selected. Select a group and run again.");
        return;
    }

    // Collect every group in the current selection. The shorthand assumes a
    // single group, but handling several keeps the script useful without
    // changing the intent.
    var groups = [];
    for (var i = 0; i < sel.length; i++) {
        if (sel[i].typename === "GroupItem") {
            groups.push(sel[i]);
        }
    }

    if (groups.length === 0) {
        alert("The selection is not a group. Select a group and run again.");
        return;
    }

    var lines = [];
    for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var header = group.name ? group.name : "(" + group.typename + ")";
        lines.push(header + ":");
        collectItemLines(group, 1, lines);
    }

    var outFile = resolveOutputFile(doc);
    writeNameList(outFile, lines);

    var itemCount = lines.length - groups.length;
    alert("Listed " + itemCount + " nested item(s) to:\n" + outFile.fsName);
}

/**
 * Recursively gathers page item names nested inside a container, indenting each
 * line by two spaces per nesting level so the output mirrors the group
 * hierarchy. Unnamed items fall back to a bracketed type label so no line is
 * blank.
 *
 * @param {GroupItem} container - Group whose children are collected.
 * @param {number} depth - Current nesting level (root children start at 1).
 * @param {Array} out - Accumulator that receives the indented lines.
 */
function collectItemLines(container, depth, out) {
    var items = container.pageItems;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var label = item.name ? item.name : "(" + item.typename + ")";
        out.push(indentBy(depth) + label);

        if (item.typename === "GroupItem") {
            collectItemLines(item, depth + 1, out);
        }
    }
}

// ExtendScript is ES3, so String.prototype.repeat is not available.
function indentBy(depth) {
    var prefix = "";
    for (var i = 0; i < depth; i++) {
        prefix += "  ";
    }
    return prefix;
}

/**
 * Resolves the output file location. Uses the document's folder when the
 * document has been saved, otherwise the Desktop.
 *
 * @param {Document} doc - The active document.
 * @returns {File} Target file for the name list.
 */
function resolveOutputFile(doc) {
    var folder = null;
    try {
        if (doc.saved && doc.path) {
            folder = doc.path;
        }
    } catch (e) {
        folder = null;
    }
    if (!folder) {
        folder = Folder.desktop;
    }
    return new File(folder.fsName + "/layerNames.txt");
}

/**
 * Writes the collected lines to disk, one per line, replacing any existing file
 * so each run reflects the current selection.
 *
 * @param {File} file - Destination file.
 * @param {Array} lines - Lines to write.
 */
function writeNameList(file, lines) {
    file.encoding = "UTF-8";
    file.lineFeed = "Unix";
    if (!file.open("w")) {
        throw new Error("Unable to open output file for writing: " + file.fsName);
    }
    try {
        for (var i = 0; i < lines.length; i++) {
            file.writeln(lines[i]);
        }
    } finally {
        file.close();
    }
}

try {
    main();
} catch (err) {
    alert("extractLayerNameList failed: " + err + (err && err.line ? " (line " + err.line + ")" : ""));
}
