import { SChartBase } from "./chart-base.js";

class SChartLine extends SChartBase {
  getSeriesConfig(entry) {
    return {
      ...super.getSeriesConfig(entry),
      mode: "line"
    };
  }

  renderSeries(ctx, layout, entry, _seriesIndex, startIndex, color) {
    const { left, top, plotWidth, plotHeight } = layout;
    const { points, includeX, yMin, yMax } = entry;
    const xMin = includeX ? entry.xMin : 0;
    const xMax = includeX ? entry.xMax : Math.max(1, points.length - 1);

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
  }
}

customElements.define("schart-line", SChartLine);
