const fs = require("fs");

// Read JSON file
fs.readFile("teams.json", "utf8", (err, data) => {
  if (err) {
    console.error("Error reading file:", err);
    return;
  }

  try {
    const teams = JSON.parse(data);

    console.log("=== Team Docs ===");

    teams.forEach((team) => {
      console.log(`\n--- ${team.name} ---`);
      console.log(`Short Name: ${team.shortName}`);
      console.log(`Code: ${team.code}`);
      console.log(`Stadium: ${team.stadium}`);
      console.log(`City: ${team.city}`);
      console.log(`Crest URL: ${team.crestUrl}`);
    });
  } catch (err) {
    console.error("Invalid JSON:", err);
  }
});
