# Track fixtures

Shared test tracks for the curve detector. The TypeScript reference (`src/logic/curves.ts`)
and the planned Kotlin / Swift ports must give the same result for every file here.

Format (one JSON file per ride):

```json
{
  "name": "Kesselberg, phone in tank bag",
  "expected": { "left": 12, "right": 14, "sensitivity": "normal" },
  "fixes": [{ "t": 1780000000000, "lat": 47.6, "lon": 11.3, "speed": 16.2, "accuracy": 4 }]
}
```

`real/` will hold recorded rides with curves counted by hand (ground truth).
