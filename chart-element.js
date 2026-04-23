class SChart extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.gridCanvas = document.createElement("canvas");
    this.plotCanvas = document.createElement("canvas");
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
          position: absolute;
          inset: 0;
          display: block;
          width: 100%;
          height: 100%;
        }

        .stack {
          position: relative;
          width: 100%;
          height: 100%;
        }
      </style>
      <div class="stack"></div>
    `;
    this.shadowRoot.querySelector(".stack").append(this.gridCanvas, this.plotCanvas);
    this.series = [];
    this.renderedCounts = new Map();
    this.lastLayoutKey = "";
    this.lastDataKey = "";
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
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    const scaleX = pixelWidth / width;
    const scaleY = pixelHeight / height;
    const layout = {
      width,
      height,
      pixelWidth,
      pixelHeight,
      scaleX,
      scaleY,
      left: 48,
      top: 20,
      plotWidth: width - 66,
      plotHeight: height - 48
    };
    const layoutKey = `${width}:${height}:${pixelWidth}:${pixelHeight}`;
    const dataKey = JSON.stringify(this.series.map((entry) => ({
      key: entry.key,
      includeX: entry.includeX === true,
      xMin: entry.xMin,
      xMax: entry.xMax,
      yMin: entry.yMin,
      yMax: entry.yMax,
      renderMode: entry.renderMode || "line",
      persistent: entry.persistent === true
    })));
    const requiresFullRedraw = layoutKey !== this.lastLayoutKey || dataKey !== this.lastDataKey;

    [this.gridCanvas, this.plotCanvas].forEach((canvas) => {
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
    });

    const grid = this.gridCanvas.getContext("2d");
    grid.setTransform(scaleX, 0, 0, scaleY, 0, 0);
    if (requiresFullRedraw) {
      this.drawGrid(grid, layout);
    }

    const plot = this.plotCanvas.getContext("2d");
    plot.setTransform(scaleX, 0, 0, scaleY, 0, 0);

    if (requiresFullRedraw) {
      plot.clearRect(0, 0, width, height);
      this.renderedCounts.clear();
      this.series.forEach((entry, seriesIndex) => this.drawSeries(plot, layout, entry, seriesIndex, 0));
    } else {
      const requiresReset = this.series.some((entry) => {
        const renderedCount = this.renderedCounts.get(entry.key) || 0;
        return entry.persistent !== true || renderedCount > entry.points.length;
      });

      if (requiresReset) {
        plot.clearRect(0, 0, width, height);
        this.renderedCounts.clear();
        this.series.forEach((entry, seriesIndex) => this.drawSeries(plot, layout, entry, seriesIndex, 0));
      } else {
        this.series.forEach((entry, seriesIndex) => {
          const renderedCount = this.renderedCounts.get(entry.key) || 0;
          this.drawSeries(plot, layout, entry, seriesIndex, renderedCount);
        });
      }
    }

    this.lastLayoutKey = layoutKey;
    this.lastDataKey = dataKey;
  }

  drawGrid(ctx, layout) {
    const { width, height, left, top, plotWidth, plotHeight } = layout;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.02)";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = top + (plotHeight * i) / 4;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + plotWidth, y);
      ctx.stroke();
    }
  }

  drawSeries(ctx, layout, entry, seriesIndex, startIndex) {
    if (!entry.points.length || startIndex >= entry.points.length) {
      this.renderedCounts.set(entry.key, entry.points.length);
      return;
    }

    const colors = ["#f59e0b", "#38bdf8", "#fb7185", "#4ade80"];
    const { left, top, plotWidth, plotHeight } = layout;
    const { points, includeX, yMin, yMax } = entry;
    const xMin = includeX ? entry.xMin : 0;
    const xMax = includeX ? entry.xMax : Math.max(1, points.length - 1);
    const color = colors[seriesIndex % colors.length];

    if (entry.renderMode === "scatter") {
      ctx.fillStyle = color;
      for (let pointIndex = startIndex; pointIndex < points.length; pointIndex += 1) {
        const point = points[pointIndex];
        const x = left + ((point.x - xMin) / (xMax - xMin || 1)) * plotWidth;
        const y = top + plotHeight - ((point.y - yMin) / (yMax - yMin || 1)) * plotHeight;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      this.renderedCounts.set(entry.key, points.length);
      return;
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let pointIndex = Math.max(0, startIndex - 1); pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      const x = left + ((point.x - xMin) / (xMax - xMin || 1)) * plotWidth;
      const y = top + plotHeight - ((point.y - yMin) / (yMax - yMin || 1)) * plotHeight;
      if (pointIndex === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    this.renderedCounts.set(entry.key, points.length);
  }
}

customElements.define("s-chart", SChart);
