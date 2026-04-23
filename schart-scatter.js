import { SChartBase } from "./chart-base.js";

class SChartScatter extends SChartBase {
  constructor() {
    super();
    this.maxXByKey = new Map();
  }

  getSeriesConfig(entry) {
    return {
      ...super.getSeriesConfig(entry),
      mode: "scatter",
      opacity: entry.opacity
    };
  }

  shouldClearPlotOnUpdate(entry) {
    if (entry.persistent !== true) {
      this.maxXByKey.delete(this.getSeriesKey(entry));
      return true;
    }

    if (!entry.points.length) {
      return false;
    }

    const key = this.getSeriesKey(entry);
    const maxSeenX = this.maxXByKey.get(key);
    if (maxSeenX === undefined) {
      return false;
    }

    if (entry.points[0].x < maxSeenX) {
      this.maxXByKey.delete(key);
      return true;
    }

    return false;
  }

  renderSeries(ctx, layout, entry, _seriesIndex, startIndex, color) {
    const { left, top, plotWidth, plotHeight } = layout;
    const { points } = entry;
    const xMin = Number.isFinite(entry.viewXMin) ? entry.viewXMin : (Number.isFinite(entry.xMin) ? entry.xMin : 0);
    const xMax = Number.isFinite(entry.viewXMax) ? entry.viewXMax : (Number.isFinite(entry.xMax) ? entry.xMax : Math.max(1, points.length - 1));
    const yMin = Number.isFinite(entry.viewYMin) ? entry.viewYMin : entry.yMin;
    const yMax = Number.isFinite(entry.viewYMax) ? entry.viewYMax : entry.yMax;

    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = Number.isFinite(entry.opacity) ? entry.opacity : 1;
    for (let pointIndex = startIndex; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      const x = left + ((point.x - xMin) / (xMax - xMin || 1)) * plotWidth;
      const y = top + plotHeight - ((point.y - yMin) / (yMax - yMin || 1)) * plotHeight;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const key = this.getSeriesKey(entry);
    const nextMaxX = points.reduce((maxX, point) => Math.max(maxX, point.x), Number.NEGATIVE_INFINITY);
    const previousMaxX = this.maxXByKey.get(key) ?? Number.NEGATIVE_INFINITY;
    this.maxXByKey.set(key, Math.max(previousMaxX, nextMaxX));
  }
}

customElements.define("schart-scatter", SChartScatter);
