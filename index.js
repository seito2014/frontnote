var path = require('path'),
    async = require('async'),
    glob = require('glob'),
    fs = require('fs-extra'),//require('fs'),
    ejs = require('ejs'),
    md = require("github-flavored-markdown"),
    extend = require('util-extend');

var VERSION = '0.0.2';


var PATTERNS = {
    comment: /\/\*\s*s?#styleguide([^*]|\*[^/])*\*\//g,
    overview: /\/\*\s*s?#overview([^*]|\*[^/])*\*\//g,
    splitter: /\n/,
    prefix: /^ *\/?\**(#styleguide|#overview)?\/? */gm,
    line: /^\s*$/gm,
    attr: /^@.+$/gm,
    attrPrefix: /^@/,
    code: /```(.|\s)+```/g,
    codeWrapper: /(```)\n?/g
};
var OPTIONS = {
    overview: __dirname + '/styleguide.md',
    template: __dirname + '/template/index.html',
    includeAssetPath: 'assets/**/*',
    css: './style.css',
    script: null,
    out: './guide',
    title: 'StyleGuide',
    verbose: false
};

var HELPERS = {
    isCurrent: function(current,file) {
        return (current.file === file.file);
    }
};

/**
 * FrontNote
 * @param target {string|array} 解析するファイルのminimatch形式文字列またはminimatch形式文字列が入った配列
 * @param option {object} オプション
 * @param callback {callback} 全ての処理が正常に終了したときに実行するコールバック関数
 * @constructor
 */
function FrontNote(target,option,callback) {
    echoLog('Start','FrontNote - ' + VERSION,'green');

    var options = extend({},OPTIONS);
    options = extend(options,option);
    options.out = path.resolve(options.out);

    if (target instanceof Array) {
        start(null,target);
    } else {
        glob(target, start);
    }

    function start(err, files) {
        if(err) throw (err);

        var data = [];
        // 外部ファイルを１つずつ読み込み
        async.forEachSeries(files, function(file, callback) {
            fs.readFile(file, 'utf8',function (err, res) {
                if (err) throw err;
                if (options.verbose) {
                    echoLog('Read',file);
                }

                var overview = res.match(PATTERNS.overview);
                if (overview) {
                    overview = parseComments(overview);
                    if (overview) {
                        overview = overview[0];
                    }
                }
                var comments = res.match(PATTERNS.comment);
                if (comments) {
                    comments = parseComments(comments);
                }
                if(overview || comments) {
                    var fileName = path.basename(file,path.extname(file));
                    data.push({
                        file: file,
                        fileName: fileName,
                        url: fileName + '.html',
                        dirs: file.split(path.sep),
                        ext: path.extname(file),
                        sections: comments,
                        overview: overview
                    });
                }
                callback();
            });
        }, function (err) {
            if (err) throw err;
            createStyleGuide(data,options,callback);
        });
    }
}

/**
 * コメントの塊をパースする
 * @param comments
 * @returns {Array}
 */
function parseComments(comments) {
    var result = [];
    for (var i = 0, len = comments.length; i < len; i++) {
        var com = parseComment(comments[i]);
        result.push(com);
    }
    return result;
}

/**
 * コメントをパースする
 * @param comment
 * @returns {{title: Array, comment: Array, attributes: (*|Array), markdown: *, html: *, code: *}}
 */
function parseComment(comment) {
    var comment = comment.replace(PATTERNS.guide,'').replace(PATTERNS.prefix,'');

    // 属性
    var attrs = filterPattern(comment,PATTERNS.attr,false);
    comment = comment.replace(PATTERNS.attr,'');

    // サンプルコード領域
    var code = filterPattern(comment,PATTERNS.code);
    comment = comment.replace(PATTERNS.code,'');

    var result = {
        title: [],
        comment: [],
        attributes: attrs || [],
        code: code
    };

    var lines = comment.split(PATTERNS.splitter),
        hasTitle = false,
        i = 0;

    for (i = 0, len = lines.length; i < len; i++) {
        var line = lines[i];
        if (!hasTitle) {
            if (line) {
                result.title.push(line);
            } else if(result.title.length !== 0) {
                hasTitle = true;
            }
        } else if (line) {
            result.comment.push(line);
        }
    }
    result.title = result.title.join('<br>');
    result.comment = result.comment.join('<br>');

    for (i = 0, len = result.attributes.length; i < len; i++) {
        result.attributes[i] = result.attributes[i].replace(PATTERNS.attrPrefix,'');
    }

    return result;
}

/**
 * 正規表現によって一致した文字列データを返却
 * @param str
 * @param pattern
 * @param trim
 * @returns {*}
 */
function filterPattern(str,pattern,trim) {
    if (trim === false) {
        return str.match(pattern);
    } else {
        var match = str.match(pattern);
        if (match) {
            return match[0].replace(PATTERNS.codeWrapper,'');
        }
        return null;
    }
}

/**
 * スタイルガイド作成
 * @param data
 * @param options
 */
function createStyleGuide(data,options,callback) {
    async.waterfall([
        //テンプレート読み込み
        function(callback) {
            //テンプレートファイルの読み込み
            fs.readFile(options.template, 'utf8',function (err, res) {
                if (err) throw(err);
                if (options.verbose) {
                    echoLog('Read',options.template);
                }
                callback(null,res);
            });
        },
        //overviewファイルを読み込んでindexを作成
        function(template,callback) {
            //styleguide.mdを読み込み
            fs.readFile(options.overview, 'utf8',function (err, res) {
                if (err) throw(err);
                if (options.verbose) {
                    echoLog('Read',options.overview);
                }
                //EJSを使ってテンプレートレンダリング
                var rendered = ejs.render(template, {
                    title: options.title,
                    current: md.parse(res),
                    files: data,
                    overview: true,
                    helpers: HELPERS,
                    css: generateIncludeCss(options.css),
                    script: generateIncludeScript(options.script)
                });
                // ディレクトリを作りつつファイル出力
                fs.outputFile(options.out + '/index.html', rendered, function (err) {
                    if (err) throw err;
                    if (options.verbose) {
                        echoLog('Write',options.out + '/index.html');
                    }
                    callback(null,template);
                });
            });
        },
        //ファイルごとにスタイルガイドを作成
        function(template,callback) {
            async.eachSeries(data,function(section,next) {
                //EJSを使ってテンプレートレンダリング
                var rend = ejs.render(template, {
                    title: options.title,
                    current: section,
                    files: data,
                    overview: false,
                    helpers: HELPERS,
                    css: generateIncludeCss(options.css),
                    script: generateIncludeScript(options.script)
                });
                if (options.verbose) {
                    echoLog('Render',section.file);
                }
                //スタイルガイド出力
                fs.writeFile(options.out + '/' + section.fileName + '.html', rend, function (err) {
                    if (err) throw err;
                    if (options.verbose) {
                        echoLog('Write',options.out + '/' + section.fileName + '.html');
                    }
                    next();
                });
            },function() {
                callback();
            });
        },
        //スタイルガイドができたらincludeするその他ファイルをコピー
        function(callback) {
            if (options.includeAssetPath) {
                // includeAssetPathが文字列ならそのまま実行、配列ならeachで回して実行
                if (typeof options.includeAssetPath === 'string') {
                    readFiles(options.includeAssetPath,callback);
                } else {
                    async.each(options.includeAssetPath,function(targetPath,next) {
                        readFiles(targetPath,next);
                    },function() {
                        callback();
                    });
                }
            } else {
                callback();
            }
            /**
             * ファイルを１つずつ読み込んでコピー
             * @param pathPattern
             * @param callback
             */
            function readFiles(pathPattern,callback) {
                async.waterfall([
                    //パターン文字列からファイルパス配列取得
                    function(next) {
                        //テンプレートディレクトリからの相対でminimatch形式の文字列を作成
                        pathPattern = path.dirname(options.template) + '/' + pathPattern;
                        //対象ファイル一覧取得
                        glob(pathPattern, function(err,files) {
                            if (err) throw(err);
                            next(null,files);
                        });
                    },
                    //ファイルパス配列をもとにファイルを出力ディレクトリに複製
                    function(files,next) {
                        copyFiles(files,options,next)
                    },
                    function() {
                        callback();
                    }
                ]);
            }
        },
        //完了
        function() {
            echoLog('Finish','FrontNote - (c)copyright frontainer.com All rights reserved.','green');
            if (callback) {
                callback();
            }
        }
    ]);
}

/**
 * ファイルをコピー
 * @param files
 * @param options
 * @param callback
 */
function copyFiles(files,options,callback) {
    async.each(files,function(file,next) {
        // ファイル情報取得
        fs.stat(file, function(err,stats) {
            if(err) throw(err);
            //ファイル以外（ディレクトリ）だったら無視して次へ
            if (!stats.isFile()) {
                next();
            } else {
                // テンプレートディレクトリからの相対パスでincludeファイルを参照
                var relPath = path.relative(path.dirname(options.template),file);
                //コピー開始
                fs.copy(file, options.out + '/' + relPath, function(err){
                    if (err) throw(err);
                    if (options.verbose) {
                        echoLog('Copy',file + ' => ' + options.out + '/' + relPath);
                    }
                    next();
                });
            }
        });
    },function() {
        callback();
    });
}

/**
 * console.logを色付きで出力
 * @param label
 * @param text
 * @param color
 */
function echoLog(label,text,color) {
    var defaultColor = '\u001b[30m'; //black
    var colorCode = defaultColor;
    switch(color) {
        case 'red':
            colorCode = '\u001b[31m';
            break;
        case 'green':
            colorCode = '\u001b[32m';
            break;
        case 'yellow':
            colorCode = '\u001b[33m';
            break;
        default:
            break;
    }
    console.log(colorCode + '[' + label + '] ' + defaultColor + text);
}

/**
 * HTMLに追加読み込みするCSSファイルパスまたはパスが入った配列からタグを生成
 * @param arr
 * @return {string|array}
 */
function generateIncludeCss(arr) {
    if (!arr) return '';
    if (typeof arr === 'string') {
        return '<link rel="stylesheet" href="'+arr+'"/>';
    }
    var result = [];
    for (var i = 0,len = arr.length; i < len; i++) {
        result.push('<link rel="stylesheet" href="'+arr[i]+'"/>');
    }
    return result.join('\n');
}
/**
 * HTMLに追加読み込みするJSファイルパスまたはパスが入った配列からタグを生成
 * @param arr {string|array}
 */
function generateIncludeScript(arr) {
    if (!arr) return '';
    if (typeof arr === 'string') {
        return '<script src="'+arr+'"></script>'
    }
    var result = [];
    for (var i = 0,len = arr.length; i < len; i++) {
        result.push('<script src="'+arr[i]+'"></script>');
    }
    return result.join('\n');
}

// プラグイン関数をエクスポート
module.exports = FrontNote;