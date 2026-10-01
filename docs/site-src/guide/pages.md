# Pages

- **Sketchbook pages** with a toggleable, **resizable thumbnail panel**,
  page-turn animation, and add/delete/navigate controls — flip back to any
  earlier page. Thumbnails render at the display's device pixel ratio, so they
  stay crisp on HiDPI screens and at any panel width.
  A **right-click menu** on the panel adds **Page Settings**, which toggles a
  page between **endless** (fills the window, the default) and **sized**
  (an exact width and height with a dashed page outline). The panel's
  **hamburger menu** (the three bars beside `+ Page`), its right-click **Add
  Page** row and **Pages > Add Page** in the menu bar hold the three ways to
  start a page: **Default New Page** matches the page in view (what `+ Page`
  has always done); **Custom New Page…** opens Page Settings with **Sized
  page** already applied so a width and height can be typed - the page is
  only added when **Add Page** is pressed, so closing the dialog leaves
  nothing behind; and **From Selection** measures the current selection,
  gives the new page those dimensions, and brings a **copy of the selection
  with it** - the copies land at the new page's origin and stay selected,
  while the originals stay where they were.
- **Turning pages** - the page bar's **‹** and **›**, **Pages > Previous Page**
  and **Next Page**, or `PageUp` and `PageDown`. Each is greyed at its end of
  the book, and a click on a thumbnail turns straight to that page. The menu
  rows and the keys are new in 1.0.0-alpha.4.6.0; the arrows always had them.
- **Multi-page sketch books** saved as portable `.skbk` JSON files.
