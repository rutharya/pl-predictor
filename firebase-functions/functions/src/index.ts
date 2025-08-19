/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/https";
// import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";
import * as fs from "fs";
import * as path from "path";

import { Timestamp } from "firebase-admin/firestore";


// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
setGlobalOptions({ maxInstances: 10 });

export const helloWorld = onRequest((request, response) => {
  logger.info("Hello logs!", { structuredData: true });
  response.send("Hello from Firebase!");
});

/**
 * An HTTP-triggered function to read the fixtures.json file,
 * parse it, and save the data to a 'fixtures' collection in Firestore.
 */
export const importFixtures = onRequest(
  // It's best practice to define options like timeout per function.
  // We give this function a longer timeout in case the import is large.
  { timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const db = admin.firestore();
      // 1. Construct the file path and read the local JSON file.
      // This is a more robust way to handle files in TypeScript/Node.js.
      const fixturesPath = path.join(__dirname, "../fixtures.json");
      const fixturesFile = fs.readFileSync(fixturesPath, "utf8");
      const fixturesData = JSON.parse(fixturesFile);
      const allFixtures = fixturesData.fixtures;

      const teamsPath = path.join(__dirname, "../teams.json");
      const teamsFile = fs.readFileSync(teamsPath, "utf8");
      const teams = JSON.parse(teamsFile);
      const teamsByCode: { [key: string]: any } = {};
      teams.forEach((team: any) => {
        teamsByCode[team.code] = team;
      });

      const batch = db.batch();
      let fixturesCount = 0;


      logger.info(`Found ${allFixtures.length} gameweeks to process.`);

      // 2. Loop through each matchday in the JSON
      allFixtures.forEach((gameweekData: any) => {
        const gameweek = parseInt(gameweekData.matchday.split(" ")[1], 10);

        // 3. Loop through each match in the gameweek
        gameweekData.matches.forEach((match: any) => {
          // 4. Parse the date and time, assuming the year 2025.
          // The time is parsed as UTC to avoid timezone issues.

          const [day, month, year] = match.date.split("/");
          const formatted = `${month}/${day}/${year}`;
          const [hours, minutes] = match.time.split(":");

          const kickoffDate = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hours) - 1, // to account for UK time
            parseInt(minutes)
          );

          if (isNaN(kickoffDate.getTime())) {
            logger.warn(`Skipping fixture with invalid date: ${formatted}`);
            return; // Skips this iteration
          }

          const ukKickoff = new Date(kickoffDate.getTime() - 60 * 60 * 1000);
          const kickoffTime = Timestamp.fromDate(ukKickoff);

          // Set the prediction deadline to be 1 hour before kickoff.
          const predictionDeadline = Timestamp.fromMillis(
            kickoffTime.toMillis() - 60 * 60 * 1000
          );

          // 5. Create a readable, unique Fixture ID
          const homeTC = teamsByCode[match.home_team].shortName;
          const awayTC = teamsByCode[match.away_team].shortName;
          const fixtureId = `GW${gameweek}-${homeTC}-${awayTC}`;

          // 6. Define the Firestore document
          const fixtureRef = db.collection("fixtures").doc(fixtureId);
          const fixtureDoc = {
            homeTeam: match.home_team,
            awayTeam: match.away_team,
            kickoffTime: kickoffTime,
            predictionDeadline: predictionDeadline,
            gameweek: gameweek,
            status: "upcoming",
            homeScore: null,
            awayScore: null,
          };

          // 7. Add the operation to a batch for efficient writing
          batch.set(fixtureRef, fixtureDoc);
          fixturesCount++;
        });
      });

      //   8. Commit the batch write to Firestore
      await batch.commit();

      const successMessage = `Successfully imported ${fixturesCount} fixtures.`;
      logger.info(successMessage);
      res.status(200).send(successMessage);
    } catch (error) {
      logger.error("Error importing fixtures:", error);
      res.status(500).send("An error occurred while importing fixtures.");
    }
  }
);

/**
 * An HTTP-triggered function to read the fixtures.json file,
 * parse it, and save the data to a 'fixtures' collection in Firestore.
 */
export const importTeams = onRequest(
  { timeoutSeconds: 300 },
  async (req, res) => {
    try {
      const db = admin.firestore();
      const teamsPath = path.join(__dirname, "../teams.json");
      const teamsFile = fs.readFileSync(teamsPath, "utf8");
      const teams = JSON.parse(teamsFile);

      const teamsCollection = db.collection("teams");

      // 2. Create a batch
      const batch = db.batch();

      // 3. Loop through the teams and add them to the batch
      teams.forEach((team: any) => {
        // Use the unique 'shortName' (e.g., "ARS") as the document ID
        const docRef = teamsCollection.doc(team.shortName);
        batch.set(docRef, team);
      });

      // 4. Commit the batch to Firestore
      await batch.commit();

      logger.info(`Successfully imported ${teams.length} teams.`);
      res.status(200).send(`Successfully imported ${teams.length} teams.`);
    } catch (error) {
      logger.error("Error importing Teams:", error);
      res.status(500).send("An error occurred while importing Teams.");
    }
  }
);

// --- START of new code block ---

// Check if the code is running in the local emulator environment
if (process.env.FUNCTIONS_EMULATOR) {
  logger.info(
    "Local environment detected. Initializing admin SDK with service account."
  );
  // IMPORTANT: Replace with the actual path to YOUR service account key
  const serviceAccount = require("/Users/ruthvikarya/.firebase/keys/pl-predictor-5c8e6-firebase-adminsdk-fbsvc-85cffa06a8.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  // In production, initialize without arguments.
  // It will automatically discover credentials.
  admin.initializeApp();
}

// --- END of new code block ---
