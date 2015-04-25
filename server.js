#!/bin/env node
//  OpenShift sample Node application
var express = require('express');
var fs = require('fs');
var cheerio = require('cheerio');
var request = require('request');
var Q = require('q');
var xml2js = require('xml2js');


var LrnkApiApp = function () {

    //  Scope.
    var self = this;


    /*  ================================================================  */
    /*  Helper functions.                                                 */
    /*  ================================================================  */

    /**
     *  Set up server IP address and port # using env variables/defaults.
     */
    self.setupVariables = function () {
        //  Set the environment variables we need.
        self.ipaddress = process.env.OPENSHIFT_NODEJS_IP;
        self.port = process.env.OPENSHIFT_NODEJS_PORT || 8080;

        if (typeof self.ipaddress === "undefined") {
            //  Log errors on OpenShift but continue w/ 127.0.0.1 - this
            //  allows us to run/test the app locally.
            console.warn('No OPENSHIFT_NODEJS_IP var, using 127.0.0.1');
            self.ipaddress = "127.0.0.1";
        }
    };


    /**
     *  Populate the cache.
     */
    self.populateCache = function () {
        if (typeof self.zcache === "undefined") {
            self.zcache = {
                'index.html': '',
                'ukchart.html': ''
            };
        }

        //  Local cache for static content.
        self.zcache['index.html'] = fs.readFileSync('./index.html');
        self.zcache['ukchart.html'] = fs.readFileSync('./ukchart.html');
    };


    /**
     *  Retrieve entry (content) from cache.
     *  @param {string} key  Key identifying content to retrieve from cache.
     */
    self.cache_get = function (key) {
        return self.zcache[key];
    };


    /**
     *  terminator === the termination handler
     *  Terminate server on receipt of the specified signal.
     *  @param {string} sig  Signal to terminate on.
     */
    self.terminator = function (sig) {
        if (typeof sig === "string") {
            console.log('%s: Received %s - terminating sample app ...',
                Date(Date.now()), sig);
            process.exit(1);
        }
        console.log('%s: Node server stopped.', Date(Date.now()));
    };


    /**
     *  Setup termination handlers (for exit and a list of signals).
     */
    self.setupTerminationHandlers = function () {
        //  Process on exit and signals.
        process.on('exit', function () {
            self.terminator();
        });

        // Removed 'SIGPIPE' from the list - bugz 852598.
        ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT',
            'SIGBUS', 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
        ].forEach(function (element, index, array) {
                process.on(element, function () {
                    self.terminator(element);
                });
            });
    };


    /*  ================================================================  */
    /*  App server functions (main app logic here).                       */
    /*  ================================================================  */

    /**
     *  Create the routing table entries + handlers for the application.
     */
    self.createRoutes = function () {
        self.routes = {};

        self.routes['/ukchart'] = function (req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.cache_get('ukchart.html'));
        };

        self.routes['/ukchart/csv'] = function (req, res) {

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="' + (req.query.date ? req.query.date + '_' : '') + 'chart.csv"');
            getChartHtml().then(
                function success(chartHtml) {
                    res.end(getCsvString(getChartData(chartHtml)));
                },
                function fail(e) {
                    process.stderr.write('Failed to get ukchart data: ' + e + '\n');
                }
            );


            function getChartHtml() {
                var chartHtmlDeferred = Q.defer();
                Q.fcall(function () {
                    request('http://www.officialcharts.com/singles-chart/', function (error, response, html) {

                        if (!error && response.statusCode == 200) {
                            chartHtmlDeferred.resolve(html);
                        } else {
                            chartHtmlDeferred.reject(response.statusCode);
                        }
                    });
                });


                return chartHtmlDeferred.promise;
            }

            function getChartData(chartHtml) {


                var chartData = [];

                $ = cheerio.load(chartHtml);

                $('tr').each(function (i, entryTr) {

                    var $entryTr = $(entryTr);

                    if ($entryTr.find(".position").length) {

                        var entry = [];

                        entry.push($entryTr.find(".position").text().trim());
                        entry.push($entryTr.find(".last-week").text().trim());
                        entry.push($($entryTr.find("td").get(4)).text().trim());

                        entry.push($entryTr.find(".artist").text().trim());
                        entry.push($entryTr.find(".title").text().trim());

                        chartData.push(entry);
                    }
                });

                return chartData;
            }

            function getCsvString(chartData) {

                var csvString = 'position,last week,weeks,artist,title\n';

                chartData.forEach(function (row) {
                    row.forEach(function (cell) {
                        csvString = csvString.concat(cell + ',');
                    });
                    csvString = csvString
                        .slice(0, -1)
                        .concat('\n');
                });

                return csvString;
            }

        };

        self.routes['/books'] = function (req, res) {

            res.setHeader('Content-Type', 'application/json');

            getBooksXml().then(
                function success(xmlData) {
                    getBooksJson(xmlData).then(
                        function (jsonData) {
                            res.end(JSON.stringify(jsonData));
                        }
                    );
                },
                function fail(e) {
                    process.stderr.write('Failed to get books data: ' + e + '\n');
                });


            function getBooksJson(xml) {
                var deferred = Q.defer();

                Q.fcall(function () {
                    xml2js.parseString(xml, function (err, result) {
                        deferred.resolve(result);
                    });
                });

                return deferred.promise;

            }

            function getBooksXml() {
                var booksDeferred = Q.defer();

                Q.fcall(function () {
                    request(
                        'https://www.goodreads.com/review/list.xml?v=2&id=4442921&key=HGxl0L4D846xCoMfL7RoJQ',
                        function (error, response, stuff) {
                            if (!error && response.statusCode == 200) {
                                booksDeferred.resolve(stuff);
                            } else {
                                booksDeferred.reject(response.statusCode);
                            }
                        });
                });

                return booksDeferred.promise;
            }
        };

        self.routes['/'] = function (req, res) {
            res.setHeader('Content-Type', 'text/html');
            res.send(self.cache_get('index.html'));
        };
    };


    /**
     *  Initialize the server (express) and create the routes and register
     *  the handlers.
     */
    self.initializeServer = function () {
        self.createRoutes();
        self.app = express.createServer();

        //  Add handlers for the app (from the routes).
        for (var r in self.routes) {
            self.app.get(r, self.routes[r]);
        }

        //serve static files
        self.app.use(express.static('public'));
    };


    /**
     *  Initializes the sample application.
     */
    self.initialize = function () {
        self.setupVariables();
        self.populateCache();
        self.setupTerminationHandlers();

        // Create the express server and routes.
        self.initializeServer();
    };


    /**
     *  Start the server (starts up the sample application).
     */
    self.start = function () {
        //  Start the app on the specific interface (and port).
        self.app.listen(self.port, self.ipaddress, function () {
            console.log('%s: Node server started on %s:%d ...',
                Date(Date.now()), self.ipaddress, self.port);
        });
    };

};
/*  Sample Application.  */


/**
 *  main():  Main code.
 */
var zapp = new LrnkApiApp();
zapp.initialize();
zapp.start();

