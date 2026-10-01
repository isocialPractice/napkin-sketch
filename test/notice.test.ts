/**
 * Session notices (src/renderer/notice.ts): the dialog that says why an
 * action did nothing. A notice shows until its "Do not show this notice
 * again" box is ticked, and then only its toast, for the rest of the
 * session; closing it hands the focus back. The GUI check
 * `check-shape-eraser.mjs` drives the same dialog in the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SessionNotices, SHAPE_ERASER_NOTICES, type Notice } from '../src/renderer/notice.js';

/** The few parts of an element the notices touch. */
class FakeElement {
  textContent = '';
  checked = false;
  onclick: (() => void) | null = null;
  onkeydown: ((ev: FakeKey) => void) | null = null;
  private readonly classes = new Set<string>();
  constructor(
    readonly id: string,
    private readonly page: FakePage,
    hidden = false,
  ) {
    if (hidden) this.classes.add('is-hidden');
  }
  readonly classList = {
    add: (name: string) => void this.classes.add(name),
    remove: (name: string) => void this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  focus(): void {
    this.page.activeElement = this;
  }
  blur(): void {
    if (this.page.activeElement === this) this.page.activeElement = null;
  }
}

interface FakeKey {
  key: string;
  stopped: boolean;
  prevented: boolean;
  stopPropagation(): void;
  preventDefault(): void;
}

function key(name: string): FakeKey {
  return {
    key: name,
    stopped: false,
    prevented: false,
    stopPropagation() {
      this.stopped = true;
    },
    preventDefault() {
      this.prevented = true;
    },
  };
}

/** The dialog's elements by id, and which of them has the focus. */
class FakePage {
  activeElement: FakeElement | null = null;
  readonly elements = new Map<string, FakeElement>();
  constructor(ids = ['notice-dialog', 'notice-title', 'notice-text', 'notice-again', 'notice-ok']) {
    for (const id of ids) this.elements.set(id, new FakeElement(id, this, id === 'notice-dialog'));
  }
  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }
  el(id: string): FakeElement {
    return this.elements.get(id)!;
  }
  get open(): boolean {
    return !this.el('notice-dialog').classList.contains('is-hidden');
  }
}

function setUp(ids?: string[]) {
  const page = new FakePage(ids);
  const toasts: string[] = [];
  const notices = new SessionNotices((text) => toasts.push(text), page as unknown as Pick<Document, 'getElementById' | 'activeElement'>);
  return { page, toasts, notices };
}

const NOTICE: Notice = SHAPE_ERASER_NOTICES.openPath;

test('a notice shows its title and sentence, unticked, with OK focused', () => {
  const { page, toasts, notices } = setUp();
  page.el('notice-again').checked = true;
  notices.show(NOTICE);
  assert.ok(page.open);
  assert.equal(page.el('notice-title').textContent, 'The top path is open');
  assert.equal(page.el('notice-text').textContent, 'The top path must be closed to erase with it.');
  assert.equal(page.el('notice-again').checked, false, 'the box starts unticked every time');
  assert.equal(page.activeElement?.id, 'notice-ok');
  assert.equal(notices.showing?.id, NOTICE.id);
  assert.deepEqual(toasts, []);
});

test('OK closes it; unticked, it shows again the next time', () => {
  const { page, toasts, notices } = setUp();
  notices.show(NOTICE);
  page.el('notice-ok').onclick!();
  assert.ok(!page.open);
  assert.equal(notices.showing, null);
  assert.equal(notices.isDismissed(NOTICE.id), false);
  notices.show(NOTICE);
  assert.ok(page.open);
  assert.deepEqual(toasts, []);
});

test('ticked away, a notice is only a toast for the rest of the session', () => {
  const { page, toasts, notices } = setUp();
  notices.show(NOTICE);
  page.el('notice-again').checked = true;
  notices.close();
  assert.ok(notices.isDismissed(NOTICE.id));
  notices.show(NOTICE);
  assert.ok(!page.open, 'the dialog stays shut');
  assert.deepEqual(toasts, [NOTICE.text]);
  // Another notice is not ticked away with it.
  notices.show(SHAPE_ERASER_NOTICES.noSelection);
  assert.ok(page.open);
  assert.equal(page.el('notice-title').textContent, 'Nothing to erase');
});

test('the dialog keeps its keys, and Enter or Escape closes it', () => {
  for (const name of ['Enter', 'Escape']) {
    const { page, notices } = setUp();
    notices.show(NOTICE);
    const ev = key(name);
    page.el('notice-dialog').onkeydown!(ev);
    assert.ok(ev.stopped && ev.prevented, name);
    assert.ok(!page.open, name);
  }
  const { page, notices } = setUp();
  notices.show(NOTICE);
  const tab = key('Tab');
  page.el('notice-dialog').onkeydown!(tab);
  assert.ok(tab.stopped, 'no key reaches the window behind it');
  assert.ok(!tab.prevented && page.open, 'and one that is not Enter or Escape does what it does in the dialog');
});

test('closing hands the focus back to where it was', () => {
  const { page, notices } = setUp([...['notice-dialog', 'notice-title', 'notice-text', 'notice-again', 'notice-ok'], 'tool-shape-eraser']);
  page.el('tool-shape-eraser').focus();
  notices.show(NOTICE);
  assert.equal(page.activeElement?.id, 'notice-ok');
  notices.close();
  assert.equal(page.activeElement?.id, 'tool-shape-eraser');
});

test('with nothing focused before, a closed notice keeps no focus on its hidden OK', () => {
  const { page, notices } = setUp();
  notices.show(NOTICE);
  notices.close();
  assert.equal(page.activeElement, null);
});

test('with the dialog missing from the page, a notice is a toast', () => {
  const { toasts, notices } = setUp(['notice-dialog', 'notice-title']);
  notices.show(NOTICE);
  assert.deepEqual(toasts, [NOTICE.text]);
  assert.equal(notices.showing, null);
});

test('each Shape Eraser notice has its own id, a title and a sentence', () => {
  const all = Object.values(SHAPE_ERASER_NOTICES);
  assert.equal(new Set(all.map((n) => n.id)).size, all.length);
  for (const n of all) assert.ok(n.title.length > 0 && /\.$/.test(n.text), n.id);
});
