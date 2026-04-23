import { SChartBase } from "./chart-base.js";

class SChartScatter extends SChartBase {
  isSeriesPersistent(entry) {
    return entry.persistent === true;
  }

  getSeriesConfig(entry) {
    return {
      ...super.getSeriesConfig(entry),
      mode: "scatter"
    };
  }

  renderSeries(ctx, layout, entry, _seriesIndex, startIndex, color) {
    const { left, top, plotWidth, plotHeight } = layout;
    const { points, includeX, yMin, yMax } = entry;
    const xMin = includeX ? entry.xMin : 0;
    const xMax = includeX ? entry.xMax : Math.max(1, points.length - 1);

    ctx.fillStyle = color;
    for (let pointIndex = startIndex; pointIndex < points.length; pointIndex += 1) {
      const point = points[pointIndex];
      const x = left + ((point.x - xMin) / (xMax - xMin || 1)) * plotWidth;
      const y = top + plotHeight - ((point.y - yMin) / (yMax - yMin || 1)) * plotHeight;
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

customElements.define("schart-scatter", SChartScatter);
