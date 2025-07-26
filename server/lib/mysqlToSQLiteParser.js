// Helper function to format SQL with consistent indentation
const formatSQL = (sql) => {
    // For simple queries (no newlines in original and no complex parts), keep them on one line
    if (!sql.includes('\n') && !sql.toLowerCase().includes('case when') && !sql.toLowerCase().includes('group by')) {
        return sql.replace(/\s+/g, ' ').trim();
    }

    const lines = sql.split('\n').map(line => line.trim()).filter(line => line);
    const result = [];
    let indentLevel = 0;

    for (let line of lines) {
        // Determine indentation
        if (line.toUpperCase().startsWith('FROM') ||
            line.toUpperCase().startsWith('WHERE') ||
            line.toUpperCase().startsWith('GROUP BY') ||
            line.toUpperCase().startsWith('HAVING') ||
            line.toUpperCase().startsWith('ORDER BY') ||
            line.toUpperCase().startsWith('LIMIT')) {
            indentLevel = 0;
        }

        // Add line with proper indentation
        const indent = '    '.repeat(Math.max(0, indentLevel));
        result.push(indent + line);

        // Adjust indent level for next line
        if (line.toUpperCase().startsWith('SELECT')) {
            indentLevel = 1;
        }
    }

    return result.join('\n');
};

// Helper function to format CREATE TABLE statements
const formatCreateTable = (sql) => {
    const lines = sql.split('\n').map(line => line.trim()).filter(line => line);
    const result = [];
    let inColumns = false;

    for (let line of lines) {
        if (line.startsWith('CREATE TABLE')) {
            const tableName = line.match(/CREATE TABLE\s+(\w+)/)[1];
            result.push(`CREATE TABLE ${tableName} (`);
            inColumns = true;
        } else if (line.endsWith(');') || line === ');' || line === ')') {
            inColumns = false;
            result.push('    );');
        } else if (inColumns) {
            // Remove trailing commas for last column
            const isLastColumn = !lines.slice(lines.indexOf(line) + 1).some(l => !l.startsWith(')'));
            const column = line.replace(/,\s*$/, '') + (isLastColumn ? '' : ',');
            result.push('    ' + column);
        } else {
            result.push(line);
        }
    }

    return result.join('\n');
};

// Helper function to handle GROUP_CONCAT
const handleGroupConcat = (sql) => {
    // Handle GROUP_CONCAT with DISTINCT
    sql = sql.replace(/GROUP_CONCAT\((DISTINCT\s+)?([^)]+)\)/gi,
        (match, distinct, args) => {
            distinct = distinct || '';
            return `GROUP_CONCAT(${distinct}${args})`;
        });

    // Handle dot notation in GROUP_CONCAT
    sql = sql.replace(/GROUP_CONCAT\(([^)]+\.[^)]+)\)/gi, 'GROUP_CONCAT($1)');

    return sql;
};

// MySQL to SQLite function mappings
const functionMappings = [
    // String Functions
    { regex: /CONCAT\((.*?)\)/g, replacement: (match, args) => args.split(',').join(' || ') },
    { regex: /SUBSTRING\((.*?)\)/g, replacement: 'substr($1)' },
    { regex: /\b(LENGTH|UPPER|LOWER|TRIM|LTRIM|RTRIM|REPLACE)\(/g, replacement: '$1(' },

    // Date/Time Functions
    { regex: /DATE_ADD\((.*?),\s*INTERVAL\s*(\d+)\s*DAY\)/g, replacement: 'DATETIME($1, \'+$2 DAY\')' },
    { regex: /DATE_SUB\((.*?),\s*INTERVAL\s*(\d+)\s*DAY\)/g, replacement: 'DATETIME($1, \'-$2 DAY\')' },
    { regex: /DATEDIFF\((.*?),(.*?)\)/g, replacement: 'CAST((JULIANDAY($1) - JULIANDAY($2)) AS INTEGER)' },
    { regex: /YEAR\((.*?)\)/g, replacement: 'CAST(strftime(\'%Y\', $1) AS INTEGER)' },
    { regex: /MONTH\((.*?)\)/g, replacement: 'CAST(strftime(\'%m\', $1) AS INTEGER)' },
    { regex: /DAY\((.*?)\)/g, replacement: 'CAST(strftime(\'%d\', $1) AS INTEGER)' },
    { regex: /NOW\(\)/g, replacement: 'DATETIME(\'now\')' },

    // Math Functions
    { regex: /CEIL\((.*?)\)/g, replacement: 'CAST(ROUND($1 + 0.5) AS INTEGER)' },
    { regex: /FLOOR\((.*?)\)/g, replacement: 'CAST($1 AS INTEGER)' },
    { regex: /\b(POW|ABS|SQRT)\(/g, replacement: '$1(' },
    { regex: /MOD\((.*?),(.*?)\)/g, replacement: '($1 % $2)' },
    { regex: /\bRAND\(\)/g, replacement: '(ABS(RANDOM()) % 1000000 + 1) / 1000000.0' },

    // Conditional Functions
    { regex: /IFNULL\((.*?),(.*?)\)/g, replacement: 'COALESCE($1, $2)' },
    { regex: /IF\((.*?),(.*?),(.*?)\)/g, replacement: 'CASE WHEN $1 THEN $2 ELSE $3 END' },
    { regex: /NULLIF\((.*?),(.*?)\)/g, replacement: 'CASE WHEN $1 = $2 THEN NULL ELSE $1 END' },

    // Type Conversions
    { regex: /\b(?:TINY|SMALL|MEDIUM|BIG)?INT\(\d+\)/g, replacement: 'INTEGER' },
    { regex: /\b(?:VAR)?CHAR\(\d+\)|TEXT\(\d+\)/g, replacement: 'TEXT' },
    { regex: /\b(?:DECIMAL|FLOAT|DOUBLE)\(\d+,\d+\)/g, replacement: 'REAL' },
    { regex: /\bTIMESTAMP\b/g, replacement: 'DATETIME' },
    { regex: /\bBINARY\b/g, replacement: 'BLOB' },

    // Join Types
    { regex: /\b(?:LEFT|RIGHT|FULL)\s+(?:OUTER\s+)?JOIN\b/g, replacement: 'LEFT JOIN' },
    { regex: /\bINNER\s+JOIN\b|\bJOIN\b/g, replacement: 'INNER JOIN' },

    // Auto-increment and Primary Key
    { regex: /AUTO_?INCREMENT(?:\s+PRIMARY\s+KEY|)/gi, replacement: 'PRIMARY KEY AUTOINCREMENT' },
    { regex: /PRIMARY\s+KEY\s+AUTO_?INCREMENT/gi, replacement: 'PRIMARY KEY AUTOINCREMENT' },
];

const mysqlToSQLiteParser = (mysqlQuery) => {
    let sqliteQuery = mysqlQuery;

    // Apply all function mappings
    functionMappings.forEach(({ regex, replacement }) => {
        sqliteQuery = sqliteQuery.replace(regex, replacement);
    });

    // Post-processing fixes
    sqliteQuery = sqliteQuery
        // Remove MySQL-specific syntax
        .replace(/ENGINE=\w+|DEFAULT CHARSET=\w+|COLLATE=\w+/g, '')
        // Clean up whitespace
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();

    // Format based on query type
    if (sqliteQuery.toLowerCase().startsWith('create table')) {
        sqliteQuery = formatCreateTable(sqliteQuery);
    } else if (sqliteQuery.toLowerCase().includes('group_concat')) {
        sqliteQuery = handleGroupConcat(sqliteQuery);
    } else {
        sqliteQuery = formatSQL(sqliteQuery);
    }

    // Warning for unsupported features
    if (sqliteQuery.includes("WITH ROLLUP")) {
        console.warn("GROUP BY WITH ROLLUP is not supported in SQLite");
        sqliteQuery = sqliteQuery.replace(/WITH ROLLUP/g, "/* WITH ROLLUP not supported */");
    }

    return sqliteQuery;
};

module.exports = mysqlToSQLiteParser;
