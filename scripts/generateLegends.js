import fs from "fs";

const legendPool = [
  ["Lionel Messi","RW","Barcelona"],
  ["Cristiano Ronaldo","ST","Real Madrid"],
  ["Neymar Jr","LW","Barcelona"],
  ["Luis Suarez","ST","Barcelona"],
  ["Robert Lewandowski","ST","Bayern Munich"],
  ["Kylian Mbappe","ST","PSG"],
  ["Erling Haaland","ST","Manchester City"],
  ["Kevin De Bruyne","CAM","Manchester City"],
  ["Mohamed Salah","RW","Liverpool"],
  ["Luka Modric","CM","Real Madrid"],

  ["Andres Iniesta","CM","Barcelona"],
  ["Xavi","CM","Barcelona"],
  ["Ronaldinho","LW","Barcelona"],
  ["Zinedine Zidane","CAM","Real Madrid"],
  ["Ronaldo Nazario","ST","Inter Milan"],
  ["Thierry Henry","ST","Arsenal"],
  ["Dennis Bergkamp","CF","Arsenal"],
  ["Johan Cruyff","CF","Ajax"],
  ["Diego Maradona","CAM","Napoli"],
  ["Pele","ST","Santos"],

  ["Paolo Maldini","CB","AC Milan"],
  ["Franz Beckenbauer","CB","Bayern Munich"],
  ["Sergio Ramos","CB","Real Madrid"],
  ["Virgil van Dijk","CB","Liverpool"],
  ["Carles Puyol","CB","Barcelona"],
  ["Alessandro Nesta","CB","AC Milan"],
  ["Fabio Cannavaro","CB","Juventus"],
  ["Roberto Carlos","LB","Real Madrid"],
  ["Cafu","RB","AC Milan"],
  ["Ashley Cole","LB","Chelsea"],

  ["Manuel Neuer","GK","Bayern Munich"],
  ["Gianluigi Buffon","GK","Juventus"],
  ["Iker Casillas","GK","Real Madrid"],
  ["Petr Cech","GK","Chelsea"],
  ["Lev Yashin","GK","Dynamo Moscow"],

  ["Frank Lampard","CM","Chelsea"],
  ["Steven Gerrard","CM","Liverpool"],
  ["Paul Scholes","CM","Manchester United"],
  ["Patrick Vieira","CDM","Arsenal"],
  ["Claude Makelele","CDM","Chelsea"],

  ["David Beckham","RM","Manchester United"],
  ["Ryan Giggs","LM","Manchester United"],
  ["Wayne Rooney","ST","Manchester United"],
  ["Didier Drogba","ST","Chelsea"],
  ["Samuel Eto'o","ST","Barcelona"],

  ["Karim Benzema","ST","Real Madrid"],
  ["Gareth Bale","RW","Real Madrid"],
  ["Arjen Robben","RW","Bayern Munich"],
  ["Franck Ribery","LW","Bayern Munich"],
  ["Thomas Muller","CAM","Bayern Munich"],

  ["George Best","RW","Manchester United"],
  ["Eusebio","ST","Benfica"],
  ["Ruud Gullit","CF","AC Milan"],
  ["Marco van Basten","ST","AC Milan"],
  ["Romario","ST","Barcelona"],

  ["Fernando Torres","ST","Liverpool"],
  ["David Villa","ST","Valencia"],
  ["Sergio Busquets","CDM","Barcelona"],
  ["Marcelo","LB","Real Madrid"],
  ["Javier Zanetti","RB","Inter Milan"],

  ["Andrea Pirlo","CM","AC Milan"],
  ["Yaya Toure","CM","Manchester City"],
  ["Xabi Alonso","CM","Real Madrid"],
  ["Michael Ballack","CM","Chelsea"],
  ["Rivaldo","CAM","Barcelona"],

  ["Kaka","CAM","AC Milan"],
  ["Figo","RW","Real Madrid"],
  ["Michael Owen","ST","Liverpool"],
  ["Raul","ST","Real Madrid"],
  ["Roberto Baggio","CF","Juventus"],

  ["Edwin van der Sar","GK","Manchester United"],
  ["Oliver Kahn","GK","Bayern Munich"],
  ["John Terry","CB","Chelsea"],
  ["Rio Ferdinand","CB","Manchester United"],
  ["Nemanja Vidic","CB","Manchester United"],

  ["Philipp Lahm","RB","Bayern Munich"],
  ["Dani Alves","RB","Barcelona"],
  ["Jordi Alba","LB","Barcelona"],
  ["Vincent Kompany","CB","Manchester City"],
  ["Gerard Pique","CB","Barcelona"],

  ["Sadio Mane","LW","Liverpool"],
  ["Harry Kane","ST","Tottenham"],
  ["Antoine Griezmann","CF","Atletico Madrid"],
  ["Eden Hazard","LW","Chelsea"],
  ["Kevin Keegan","ST","Hamburg"],

  ["Alan Shearer","ST","Blackburn"],
  ["Ruud van Nistelrooy","ST","Manchester United"],
  ["Robin van Persie","ST","Arsenal"],
  ["Zlatan Ibrahimovic","ST","PSG"],
  ["Luis Figo","RW","Real Madrid"],

  ["Clarence Seedorf","CM","AC Milan"],
  ["Edgar Davids","CM","Juventus"],
  ["Lothar Matthaus","CM","Inter Milan"],
  ["Bobby Charlton","CAM","Manchester United"],
  ["Gerd Muller","ST","Bayern Munich"],

  ["Ferenc Puskas","ST","Real Madrid"],
  ["George Weah","ST","AC Milan"],
  ["Kenny Dalglish","CF","Liverpool"],
  ["Ronald Koeman","CB","Barcelona"],
  ["Jaap Stam","CB","Manchester United"]
];



let id = 1;
const cards = [];

for (const player of legendPool) {
  const [name, position, club] = player;

  for (let seasonNo = 1; seasonNo <= 5; seasonNo++) {
    const rating =
      90 + Math.floor(Math.random() * 10);

    const goals =
      position === "GK"
        ? 0
        : Math.floor(
            rating * (0.3 + Math.random() * 0.5)
          );

    const assists =
      position === "GK"
        ? 0
        : Math.floor(
            rating * (0.1 + Math.random() * 0.25)
          );

    cards.push({
      id: id++,
      name,
      season: `Prime ${seasonNo}`,
      club,
      position,
      goals,
      assists,
      appearances:
        40 + Math.floor(Math.random() * 20),
      rating
    });
  }
}

fs.writeFileSync(
  "./src/data/playerSeasons.json",
  JSON.stringify(cards, null, 2)
);

console.log(
  `Generated ${cards.length} season cards`
);