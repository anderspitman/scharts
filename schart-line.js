import { SChartBase } from "./chart-base.js";

class SChartLine extends SChartBase {
  constructor() {
    super();
    this.maxXByKey = new Map();
    this.lastPointByKey = new Map();
  }

  getSeriesConfig(entry) {
    return {
      ...super.getSeriesConfig(entry),
      mode: "line"
    };
  }

  shouldClearPlotOnUpdate(entry) {
    if (entry.persistent !== true) {
      const key = this.getSeriesKey(entry);
      this.maxXByKey.delete(key);
      this.lastPointByKey.delete(key);
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
      this.lastPointByKey.delete(key);
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
    const key = this.getSeriesKey(entry);
    const previousPoint = this.lastPointByKey.get(key) || null;

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let pointIndex = Math.max(0, startIndex); pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      const x = left + ((point.x - xMin) / (xMax - xMin || 1)) * plotWidth;
      const y = top + plotHeight - ((point.y - yMin) / (yMax - yMin || 1)) * plotHeight;
      if (pointIndex === startIndex) {
        if (previousPoint) {
          const previousX = left + ((previousPoint.x - xMin) / (xMax - xMin || 1)) * plotWidth;
          const previousY = top + plotHeight - ((previousPoint.y - yMin) / (yMax - yMin || 1)) * plotHeight;
          ctx.moveTo(previousX, previousY);
          ctx.lineTo(x, y);
        } else {
          ctx.moveTo(x, y);
        }
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    const nextMaxX = points.reduce((maxX, point) => Math.max(maxX, point.x), Number.NEGATIVE_INFINITY);
    const previousMaxX = this.maxXByKey.get(key) ?? Number.NEGATIVE_INFINITY;
    this.maxXByKey.set(key, Math.max(previousMaxX, nextMaxX));
    this.lastPointByKey.set(key, points[points.length - 1]);
  }
}

customElements.define("schart-line", SChartLine);
