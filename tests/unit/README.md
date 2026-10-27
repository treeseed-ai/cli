# Unit tier

No isolated CLI unit suite exists yet. The command-classification test constructs the real
Cordis application and belongs to integration. `test:unit` reports the empty tier explicitly;
future isolated specifications placed here are discovered normally. Acceptance, regression
and integration remain required. Do not add duplicate tests to manufacture a unit count.
