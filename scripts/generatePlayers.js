import axios from "axios";

const API_KEY = "bd51d5c0239ed211afd38843291a6742";

const MESSI_ID = 154;

async function getMessiCareer() {
  const seasons = [];

  for (let year = 2004; year <= 2025; year++) {
    try {
      console.log(`Checking ${year}...`);

      const response = await axios.get(
        `https://v3.football.api-sports.io/players?id=${MESSI_ID}&season=${year}`,
        {
          headers: {
            "x-apisports-key": API_KEY,
          },
        }
      );

      if (response.data.response.length > 0) {
        seasons.push({
          season: year,
          data: response.data.response[0],
        });

        console.log(`✅ ${year}`);
      } else {
        console.log(`❌ ${year}`);
      }
    } catch (err) {
      console.log(`Error on ${year}`);
    }
  }

  console.log(
    JSON.stringify(seasons, null, 2)
  );
}

getMessiCareer();