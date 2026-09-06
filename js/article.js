(() => {
  const THEME_KEY = "cocofhu-article-theme";
  const root = document.documentElement;

  function readTheme() {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === "light" || saved === "dark") return saved;
    } catch (_) {}
    return "dark";
  }

  function applyTheme(theme, persist) {
    const next = theme === "light" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    const seg = document.getElementById("artThemeSeg");
    if (seg) {
      const isLight = next === "light";
      seg.setAttribute("aria-checked", isLight ? "true" : "false");
      seg.setAttribute(
        "aria-label",
        isLight ? "当前浅色主题，点击切换为深色" : "当前深色主题，点击切换为浅色"
      );
    }
    if (persist) {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (_) {}
    }
  }

  // Sync from storage (head script may already have set it)
  applyTheme(readTheme(), false);

  const seg = document.getElementById("artThemeSeg");
  if (seg) {
    const toggle = () => {
      const cur = root.getAttribute("data-theme") === "light" ? "light" : "dark";
      applyTheme(cur === "dark" ? "light" : "dark", true);
    };
    seg.addEventListener("click", toggle);
    seg.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    });
  }

  const toc = document.getElementById("artToc");
  const toggleBtn = document.getElementById("artTocToggle");
  const links = [...document.querySelectorAll(".art-toc-nav a[href^='#']")];

  function setOpen(open) {
    if (!toc || !toggleBtn) return;
    toc.classList.toggle("is-open", open);
    toggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  if (toggleBtn && toc) {
    toggleBtn.addEventListener("click", () => {
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
