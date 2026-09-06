(() => {
  const toc = document.getElementById("artToc");
  const toggle = document.getElementById("artTocToggle");
  const links = [...document.querySelectorAll(".art-toc-nav a[href^='#']")];

  function setOpen(open) {
    if (!toc || !toggle) return;
    toc.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  if (toggle && toc) {
    toggle.addEventListener("click", () => {
      setOpen(!toc.classList.contains("is-open"));
    });
    toc.addEventListener("click", (event) => {
      if (event.target.closest("a") && window.matchMedia("(max-width: 920px)").matches) {
        setOpen(false);
      }
    });
  }

  if (!links.length) return;

  const headings = links
    .map((link) => {
      const id = decodeURIComponent(link.getAttribute("href").slice(1));
      const heading = document.getElementById(id);
      return heading ? { link, heading } : null;
    })
    .filter(Boolean);

  function mark(active) {
    links.forEach((link) => {
      const on = link === active;
      link.classList.toggle("is-on", on);
      link.parentElement?.classList.toggle("active", on);
    });
  }

  function sync() {
    const y = window.scrollY + 96;
    let current = headings[0];
    for (const item of headings) {
      if (item.heading.offsetTop <= y) current = item;
    }
    if (current) mark(current.link);
  }

  window.addEventListener("scroll", sync, { passive: true });
  sync();
})();
