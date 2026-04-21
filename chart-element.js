class SChart extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.canvas = document.createElement("canvas");
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          min-height: 320px;
          background:
            radial-gradient(circle at top left, rgba(255, 186, 73, 0.22), transparent 28%),
            linear-gradient(135deg, #0f172a, #111827 55%, #1f2937);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 16px;
          overflow: hidden;
        }

        canvas {
          display: block;
          width: 100%;
          height: 100%;
        }
      </style>
    `;
    this.shadowRoot.append(this.canvas);
    this.series = [];
    this.resizeObserver = new ResizeObserver(() => this.render());
  }

  connectedCallback() {
    this.resizeObserver.observe(this);
    this.render();
  }

  disconnectedCallback() {
    this.resizeObserver.disconnect();
  }

  set data(value) {
    this.series = Array.isArray(value) ? value : [];
    this.render();
  }

  render() {
    const width = Math.max(320, this.clientWidth || 640);
    const height = Math.max(240, this.clientHeight || 360);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = width * dpr;
    this.canvas.height = height * dpr;

    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.fillRect(0, 0, width, height);

    const left = 48;
    const top = 20;
    const plotWidth = width - left - 18;
    const plotHeight = height - top - 28;

    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotHeight * i) / 4;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotWidth, y);
      ctx.stroke();
    }

    const colors = ["#f59e0b", "#38bdf8", "#fb7185", "#4ade80"];

    this.series.forEach((entry, seriesIndex) => {
      if (!entry.points.length) {
        return;
      }
      const { points, xMin, xMax, yMin, yMax } = entry;

      ctx.strokeStyle = colors[seriesIndex % colors.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      points.forEach((point, pointIndex) => {
        const x = left + ((point.x - xMin) / (xMax - xMin || 1)) * plotWidth;
        const y = top + plotHeight - ((point.y - yMin) / (yMax - yMin || 1)) * plotHeight;
        if (pointIndex === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    });
  }
}

customElements.define("s-chart", SChart);
