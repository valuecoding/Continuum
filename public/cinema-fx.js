(() => {
  const params = new URLSearchParams(location.search);
  if (params.get("cinema") !== "1") return;

  document.documentElement.classList.add("cinema");

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/cinema.css";
  document.head.append(link);

  const endcard = document.createElement("div");
  endcard.id = "cinema-endcard";
  endcard.innerHTML = `
    <div>
      <p class="brand">CONTINUUM</p>
      <h1>Memory is the product.</h1>
      <p>CockroachDB · Amazon Bedrock · MCP</p>
    </div>
  `;
  document.body.append(endcard);

  window.__continuumCinema = {
    clearFocus() {
      for (const el of document.querySelectorAll(".cinema-focus, .cinema-focus-click")) {
        el.classList.remove("cinema-focus", "cinema-focus-click");
      }
    },
    focus(selector) {
      this.clearFocus();
      const el = document.querySelector(selector);
      if (!el) return;
      el.classList.add("cinema-focus");
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    },
    markClick(selector) {
      const el = document.querySelector(selector);
      if (!el) return;
      el.classList.add("cinema-focus", "cinema-focus-click");
    },
    showEndcard() {
      this.clearFocus();
      endcard.classList.add("show");
    },
  };
})();
