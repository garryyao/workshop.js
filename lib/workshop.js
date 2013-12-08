/*
 * workshop.js
 * https://github.com/garryyao/workshop.js
 *
 * Copyright (c) 2013 Garry Yao
 * Licensed under the MIT license.
 */

'use strict';
var inquirer = require("inquirer");
var glob = require("glob");
var path = require("path");
var grunt = require("grunt");
var _ = require("underscore");
var level = require("level");
var async = require("async");

var WRONG_ANSWER = "Try again :(";
var DIV_LINE = ['', new inquirer.Separator(), ''].join('\n');
var ROOT = process.cwd();

function skippable(question, inquirer, nextFn) {
	var stdin = process.stdin;

	function handleCheatKey(stroke, key) {
		// Skip the question on ctrl-s.
		if (key && key.name === 's' && key.ctrl) {
			console.log("\nSkipped...", question.name);
			inquirer.onForceClose();
			next();
		}
	}

	var KEYPRESS = "keypress";
	stdin.on(KEYPRESS, handleCheatKey);
	function next() {
		stdin.removeListener(KEYPRESS, handleCheatKey);
		nextFn();
	}

	return next;
}
module.exports = function(options) {

	level(path.join(ROOT, '.workshop'), function(err, db) {

		function leave(msg) {
			console.log(msg);
			db && db.close();
			process.exit(0);
		}

		if (err)
			leave("Failed to boot workshop.");

		var dir = options.cwd;
		var validators = options.validators;
		var paths = glob.sync("**/q.yaml", {cwd: dir});
		var questions = _.compact(_.map(paths, function(p) {
			var f = path.resolve(dir, p);
			var q = grunt.file.readYAML(f);

			// Normalize into a list of questions.
			if (!_.isArray(q))
				q = [q];

			// File name relative to the
			p = path.relative(ROOT, f);
			var basepath = path.dirname(p).replace(new RegExp(path.sep, "gi"), '-');
			_.each(q, function(ques, i) {
				if (!ques.name)
					ques.name = q.length > 1 ? [basepath, i + 1].join('-') : basepath;
				ques.cwd = path.dirname(f);
				ques.cwp = basepath;
			});
			return q;
		}));

		// Handle multiple questions per YAML file.
		questions = _.flatten(questions, true);

		// Hash of passed keys.
		var passedQ = {};
		db.createKeyStream().on('data',function(key) {
			passedQ[key] = 1;
		}).on('close', function() {

				// Filtering out unwanted questions.
				questions = _.filter(questions, function(q) {
					return q.message && q.type && !passedQ[q.name];
				});

				if (!questions.length) {
					leave("No more challenges in this workshop, bye. \n" +
								"To restart the workshop, simply delete .workshop directory.");
				}

				// Prepare for the inquires.
				questions = questions.map(function(q) {
					// Accept sequence number instead of original string as answer(s) for list and checkbox.
					if (q.type === 'list' && _.isNumber(q.answer))
						q.answer = q.choices[q.answer - 1];
					else
						if (q.type === 'checkbox' && _.isArray(q.answer)) {
							q.answer = _.map(q.answer, function(ans) {
								if (_.isNumber(ans))
									return q.choices[ans - 1];
								else
									return ans;
							});
						}
						// Resolve answer file to canonical path.
						else
							if (q.type === 'file') {
								q.default = path.join(q.cwd, q.default);
								q.message += [DIV_LINE, 'Work out the following source:', '\n'].join('');
								var files = q.source;
								if (!_.isArray(files))
									files = [files];
								_.each(files, function(file) {
									q.message += '- ' + path.join(q.cwd, file) + '\n';
								});
								q.message += '\n\n' + 'Ready to verify against the following test?';
							}

					// Append file content to question message.
					var content;
					if (q.messageFile) {
						content = grunt.file.read(path.join(q.cwd, q.messageFile));
						q.message = [q.message, '\n\n', content, DIV_LINE].join('');
					}

					// Resolver provided for particular question type.
					if (q.type in validators)
						q.validate = validators[q.type];
					else {
						q.validate = function(actual) {
							var expected = q.answer;
							// Flatten the array.
							if (_.isArray(actual)) {
								actual = actual.join();
								expected = expected.join();
							}
							// Strictly equal as default resolving.
							return expected === actual || WRONG_ANSWER;
						};
					}
					return q;
				});

				// Kick off all inquires in series.
				async.eachSeries(questions, function eachQues(q, nextQ) {
					// Wrap the next question handler.
					nextQ = skippable(q, inquirer, nextQ);
					inquirer.prompt(q, function() {
						db.put(q.name, 1, function() {
							nextQ();
						})
					});
				}, function allDone() {
					leave("All questions are cleared, awesome!");
				});
			});

	});
}
