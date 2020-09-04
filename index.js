const axios = require("axios");
const express = require("express");
const path = require('path')
const cors = require("cors");
const apiFile = require("./search_env.json");
const admin = require('firebase-admin');

let app = express();

//API URL's and keys
let iexCaseUrl = apiFile["iex_base_api_url"];

//Firebase admin
const serviceAccount = require("./firebase-admin-sdk.json");
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://stonkex-37533.firebaseio.com"
});

//Firestore
const db = admin.firestore();

//Hosting information
const PORT = process.env.PORT || 5000

app
  .use(express.static(path.join(__dirname, 'public')))
  .use(express.json())
  .use(cors())
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs')
  .get('/', (req, res) => res.send('Welcome!'))
  .listen(PORT, () => console.log(`Listening on ${ PORT }`))

  app.get('/home', async(req, res) => {
    let idToken = req.query.token;
    await admin.auth().verifyIdToken(idToken)
    .then(function(decodedToken) {
        let uid = decodedToken.uid;
        admin.auth().getUser(uid)
        .then(function(userRecord) {
            let randomInt = Math.floor(Math.random() * apiFile["iex_api_key"].length);
            let iexApiKey = apiFile["iex_api_key"][randomInt];
            let email = userRecord.toJSON().email;
            let jsonData = {}
            db.collection("users").doc(email)
            .onSnapshot((doc) => {
                let userFirstName = doc.data().fname;
                jsonData.name = userFirstName;
                db.collection("leaderboard").doc(email).get()
                .then(async(doc) => {
                jsonData.money = doc.data().money;
                jsonData.portfolio = doc.data().portfolio;
                jsonData.invested = doc.data().invested;
                let stonks = doc.data().stocks;
                if(stonks === undefined){
                    jsonData.stocks = {};
                }
                else{
                    let portfolioVal = 0;
                    await axios.get(`${iexCaseUrl}stable/stock/market/batch?symbols=${Object.keys(stonks)}&types=quote&token=${iexApiKey}`)
                    .then((response) => {
                        jsonData.stocks = response.data;
                        for (let val in response.data){
                            jsonData.stocks[val]['quantity'] = Number(stonks[val]);
                            portfolioVal += parseInt(stonks[val]) * parseFloat(response.data[val].quote.latestPrice);
                        }
                    })
                    .catch((err) => {
                        res.status(400);
                        res.send("Error!");
                    })
                    db.collection("leaderboard").doc(email).update({
                        portfolio: Number((portfolioVal).toFixed(2))
                    });
                    jsonData.portfolio = Number((portfolioVal).toFixed(2));
                }
                res.status(200);
                res.json(jsonData);
                });
            });
        })
        .catch(function(error) {
            res.status(400);
            res.send("Error!");
        });
        // ...
    }).catch(function(error) {
        res.status(400);
        res.send("Error!");
    });
})

app.get('/search', async(req, res) => {
    let term = req.query.term;
    let randomInt = Math.floor(Math.random() * apiFile["iex_api_key"].length);
    let iexApiKey = apiFile["iex_api_key"][randomInt];
    let jsonData = {}
    await axios.get(`${iexCaseUrl}stable/stock/market/batch?symbols=${term}&types=quote&token=${iexApiKey}`)
    .then((response) => {
        jsonData.data = response.data;
        jsonData.message = "Found";
        res.status(200);
        res.json(jsonData);
    })
    .catch((err) => {
        jsonData.message = err.response.statusText;
        res.status(200);
        res.json(jsonData);
    })
})

app.post('/buy', async(req, res) => {
    let idToken = req.body['user'];
    await admin.auth().verifyIdToken(idToken)
    .then(function(decodedToken) {
        let uid = decodedToken.uid;
        admin.auth().getUser(uid)
        .then(function(userRecord) {
            let randomInt = Math.floor(Math.random() * apiFile["iex_api_key"].length);
            let iexApiKey = apiFile["iex_api_key"][randomInt];
            let email = userRecord.toJSON().email;
            let symbol = req.body['symbol'];
            let amount = parseInt(req.body['amount']);
            db.collection("leaderboard").doc(email).get()
            .then((doc) => {
                let currentFunds = doc.data().money;
                axios.get(`${iexCaseUrl}stable/stock/market/batch?symbols=${symbol}&types=quote&token=${iexApiKey}`)
                .then((snap) => {
                    let totalAmt = parseFloat(snap.data[symbol].quote.latestPrice) * amount;
                    if(amount < 1) {
                        res.status(200);
                        res.send("Invalid input for amount!");
                    }
                    if(totalAmt > currentFunds){
                        res.status(200);
                        res.send("Insufficient Funds!")
                    }
                    else{
                        let newFunds = (currentFunds - (snap.data[symbol].quote.latestPrice * parseInt(amount))).toFixed(2);
                        newFunds = parseFloat(newFunds);
                        let newInvested = parseFloat((doc.data().invested + snap.data[symbol].quote.latestPrice * amount).toFixed(2));
                        let newPortfolio = parseFloat((doc.data().portfolio + snap.data[symbol].quote.latestPrice * amount).toFixed(2));
                        if (doc.data().stocks === undefined){
                            let temp = {};
                            temp[symbol] = Number(amount);
                            db.collection("leaderboard").doc(email).update({
                                money: newFunds,
                                stocks: temp,
                                invested: newInvested,
                                portfolio: newPortfolio
                            });
                        }
                        else {
                            let currentStockArray = doc.data().stocks;
                            if(doc.data().stocks[symbol] === undefined){
                                currentStockArray[symbol] = Number(amount);
                                db.collection("leaderboard").doc(email).update({
                                    money: newFunds,
                                    stocks: currentStockArray,
                                    invested: newInvested,
                                    portfolio: newPortfolio
                                });
                            }
                            else{
                                let num = Number(doc.data().stocks[symbol]);
                                currentStockArray[symbol] = Number(num + amount);
                                db.collection("leaderboard").doc(email).update({
                                    money: newFunds,
                                    stocks: currentStockArray,
                                    invested: newInvested,
                                    portfolio: newPortfolio
                                });
                            }
                        }
                        res.status(200);
                        res.send("Bought stocks!");
                    }
                })
                .catch((err) => {
                    res.status(400);
                    res.send("Error");
                });

            })
            .catch((err) => {
                res.status(400);
                res.send("Error");
            });
        })
        .catch((err) => {
            res.status(400);
            res.send("Error");
        });
    })
    .catch((err) => {
        res.status(400);
        res.send("Error");
    });
})

app.get('/leaderboard', async(req, res) => {
    let jsonData = {};
    await db.collection("leaderboard").get()
    .then((snap) => {
        snap.forEach(async(doc) => {
            let email = doc.id;
            if (doc.data().stocks !== undefined){
                let randomInt = Math.floor(Math.random() * apiFile["iex_api_key"].length);
                let iexApiKey = apiFile["iex_api_key"][randomInt];
                let stonks = doc.data().stocks;
                let portfolioVal = 0;
                await axios.get(`${iexCaseUrl}stable/stock/market/batch?symbols=${Object.keys(stonks)}&types=quote&token=${iexApiKey}`)
                .then((response) => {
                    for (let val in response.data){
                        portfolioVal += parseInt(stonks[val]) * parseFloat(response.data[val].quote.latestPrice);
                    }
                })
                .catch((err) => {
                    console.log(err);
                })
                db.collection("leaderboard").doc(email).update({
                    portfolio: Number((portfolioVal).toFixed(2))
                });
            }
        })
    })
    .catch((err) => {
        jsonData.message = "Error";
        res.status(400);
        res.json(jsonData);
    })
    let lb = [];
    await db.collection("leaderboard").get()
    .then((querySnap) => {
        let data = [];
        let temp = [];
        querySnap.forEach((doc) => {
            let d = doc.data();
            d.email = doc.id
            d.currentSum = Number(parseFloat(doc.data().money+doc.data().portfolio).toFixed(2));
            data.push(d);
        });
        //Script to rank users
        temp = data.sort(function(a, b) {
            return (b.currentSum) - (a.currentSum)
        });
        let currentRank = 1;
        let counter = 1;
        let currentSum = temp[0].currentSum;
        temp[0].rank = currentRank;
        while (counter < temp.length){
            if (currentSum === (temp[counter].currentSum)) {
                temp[counter].rank = currentRank;
            }
            else{
                temp[counter].rank = counter+1;
                currentSum = temp[counter].currentSum;
                currentRank++;
            }
            counter++;
        }
        for (let user of temp){
            let p = {};
            p.name = user.name;
            p.currentSum = user.currentSum;
            p.rank = user.rank;
            p.email = user.email;
            lb.push(p);
        }
    })
    .catch((err) => {
        jsonData.message = "Error";
        res.status(400);
        res.json(jsonData);
    })
    jsonData.data = lb;
    jsonData.message = "Success";
    res.status(200);
    res.json(jsonData);
})

app.post('/sell', (req, res) => {
    let randomInt = Math.floor(Math.random() * apiFile["iex_api_key"].length);
    let iexApiKey = apiFile["iex_api_key"][randomInt];
    let email = req.body['user'];
    if(email === undefined){
        res.status(200);
        res.send("Missing email");
    }
    else{
        let symbol = req.body['symbol'];
        let amount = Number(req.body['amount']);
        db.collection("leaderboard").doc(email).get()
        .then((doc) => {
            if(amount < 1) {
                res.status(200);
                res.send("Invalid input for amount!");
            }
            else if(amount > Number(doc.data().stocks[symbol])) {
                res.status(200);
                res.send("Insufficient stocks!");
            }
            else {
                let currentFunds = doc.data().money;
                axios.get(`${iexCaseUrl}stable/stock/market/batch?symbols=${symbol}&types=quote&token=${iexApiKey}`)
                .then((response) => {
                    let totalAmt = response.data[symbol].quote.latestPrice * parseInt(amount);
                    let newFunds = Number((currentFunds + (response.data[symbol].quote.latestPrice * Number(amount))).toFixed(2));
                    let newNum = Number(doc.data().stocks[symbol]) - Number(amount);
                    let newInvested = Number(parseFloat((doc.data().invested - response.data[symbol].quote.latestPrice * Number(amount)).toFixed(2)));
                    let newPortfolio = Number(parseFloat((doc.data().portfolio - response.data[symbol].quote.latestPrice * Number(amount)).toFixed(2)));
                    let currentStockArray = doc.data().stocks;
                    if(newNum == 0) {
                        delete currentStockArray[symbol];
                        db.collection("leaderboard").doc(email).update({
                            money: newFunds,
                            stocks: currentStockArray,
                            invested: newInvested,
                            portfolio: newPortfolio
                        });
                        }
                    else {
                    currentStockArray[symbol] = newNum;
                    db.collection("leaderboard").doc(email).update({
                        money: newFunds,
                        stocks: currentStockArray,
                        invested: newInvested,
                        portfolio: newPortfolio
                    });
                    }
                    res.status(200);
                    res.send("Success!");
                })
            }
        })
    }
})