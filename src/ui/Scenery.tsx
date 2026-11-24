/**
 * Calm background picture: layered mountain ridges with a winding road, slowly drifting clouds
 * and a sun / moon. Purely decorative (aria-hidden), very low contrast so text stays readable,
 * follows light / dark colours, and stands still for "reduce motion".
 */
export function Scenery() {
  return (
    <div className="scenery" aria-hidden="true">
      <svg className="sc-sky" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice">
        <circle className="sc-sun" cx="318" cy="92" r="26" />
        <g className="sc-clouds">
          <path className="sc-cloud" d="M40 70c4-10 18-12 24-4 6-8 20-6 22 4 9 0 12 10 4 12H40c-9-2-8-12 0-12z" />
          <path className="sc-cloud sc-cloud-2" d="M210 46c3-8 14-9 19-3 5-6 16-5 18 3 7 0 9 8 3 10h-40c-7-2-6-10 0-10z" />
          <path className="sc-cloud sc-cloud-3" d="M120 112c3-7 12-8 16-3 4-5 13-4 15 3 6 0 8 7 3 8h-34c-6-1-5-8 0-8z" />
        </g>
        <g className="sc-birds">
          <path d="M150 80q4-4 8 0q4-4 8 0" />
          <path d="M168 72q3-3 6 0q3-3 6 0" />
        </g>
      </svg>
      <svg className="sc-hills" viewBox="0 0 400 160" preserveAspectRatio="xMidYMax slice">
        <path className="sc-far" d="M0 120 L30 92 L52 104 L88 60 L118 92 L150 70 L186 98 L222 52 L258 90 L290 74 L326 100 L360 66 L400 96 V160 H0Z" />
        <path className="sc-snow" d="M88 60 L80 70 L90 68 L96 74 Z M222 52 L213 64 L224 61 L231 68 Z M360 66 L352 76 L362 74 L367 79 Z" />
        <path className="sc-mid" d="M0 132 C40 110 70 118 104 104 C140 90 170 116 206 108 C246 98 270 86 306 102 C340 116 370 104 400 110 V160 H0Z" />
        <path className="sc-road" d="M60 160 C90 150 140 148 150 140 C162 130 120 128 132 120 C146 112 196 116 214 108" />
        <path className="sc-road-dash" d="M60 160 C90 150 140 148 150 140 C162 130 120 128 132 120 C146 112 196 116 214 108" />
        <path className="sc-near" d="M0 146 C60 132 110 150 170 140 C230 130 280 150 340 138 C366 133 386 136 400 140 V160 H0Z" />
      </svg>
    </div>
  );
}
