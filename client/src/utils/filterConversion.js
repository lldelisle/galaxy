/**
 * This module handles the filtering for content items. User specified filters are applied on the data available in the store and
 * are additionally parsed as query parameters to the API endpoint. User can engage filters by specifying a query QUERY:VALUE pair
 * e.g. hid:61 in the history search field. Each query key has a default suffix defined e.g. hid:61 is equivalent to hid-eq:61.
 * Additionally, underscores and dashes in the QUERY are interchangeable. Quotation marks (') are only allowed in the VALUE.
 * Comparison aliases are allowed converting e.g. ">" to "-gt:" and "<" to "-lt". The following query pairs are equivalent:
 * create_time:'March 12, 2022', create-time-lt:'March 12, 2022'.
 *
 * The format is: `QUERY[:, < or >]VALUE`. QUERYs may only contain characters and, interchangeably, underscores (_) and dashes (-).
 * Use quotations (') around values containing spaces.
 */

/** Default filters are set, unless explicitly specified by the user. */
export const defaultFilters = {
    deleted: false,
    visible: true,
};

/** Add comparison aliases i.e. '*>value' is converted to '*_gt=value' */
export const validAlias = [
    [">", "_gt"],
    ["<", "_lt"],
];

/** Converts user input to backend compatible date. */
function toDate(value) {
    return Date.parse(value) / 1000;
}

/** Converts user input for case-insensitive filtering. */
export function toLower(value) {
    return String(value).toLowerCase();
}

/** Converts user input to boolean. */
export function toBool(value) {
    return toLower(value) === "true";
}

/** Converts user input to lower case and strips quotation marks. */
export function toLowerNoQuotes(value) {
    return toLower(value).replaceAll("'", "");
}

/** Converts name tags starting with '#' to 'name:' */
export function expandNameTag(value) {
    if (value && typeof value === "string" && value.startsWith("#")) {
        value = value.replace("#", "name:");
    }
    return toLower(value);
}

/**
 * Checks if a query value is equal to the item value
 * @param {*} attribute of the content item
 * @param {*} query parameter if the attribute does not match the server query key
 * @param {*} converter if item attribute value has to be transformed e.g. to a date.
 */
function equals(attribute, query = null, converter = null) {
    return {
        attribute,
        converter,
        query: query || `${attribute}-eq`,
        handler: (v, q) => {
            if (converter) {
                v = converter(v);
                q = converter(q);
            }
            return toLower(v) === toLower(q);
        },
    };
}

/**
 * Checks if a query value is part of the item value
 * @param {*} attribute of the content item
 * @param {*} query parameter if the attribute does not match the server query key
 * @param {*} converter if item attribute value has to be transformed e.g. to a date.
 */
function contains(attribute, query = null, converter = null) {
    return {
        attribute,
        converter,
        query: query || `${attribute}-contains`,
        handler: (v, q) => {
            if (converter) {
                v = converter(v);
                q = converter(q);
            }
            return toLower(v).includes(toLower(q));
        },
    };
}

/**
 * Checks if a value is greater or smaller than the item value
 * @param {*} attribute of the content item
 * @param {*} variant specifying the comparison operation e.g. le(<=) and gt(>)
 * @param {*} converter if item attribute value has to be transformed e.g. to a date.
 */
function compare(attribute, variant, converter = null) {
    return {
        attribute,
        converter,
        query: `${attribute}-${variant}`,
        handler: (v, q) => {
            if (converter) {
                v = converter(v);
                q = converter(q);
            }
            switch (variant) {
                case "lt":
                    return v < q;
                case "le":
                    return v <= q;
                case "ge":
                    return v >= q;
                case "gt":
                    return v > q;
            }
        },
    };
}

/** Valid filter fields and handlers which can be used for text searches. */
export const validFilters = {
    hid: equals("hid"),
    state: equals("state"),
    name: contains("name"),
    extension: equals("extension"),
    annotation: contains("annotation"),
    hid_ge: compare("hid", "ge"),
    hid_gt: compare("hid", "gt"),
    hid_le: compare("hid", "le"),
    hid_lt: compare("hid", "lt"),
    tag: contains("tags", "tag", expandNameTag),
    visible: equals("visible", "visible", toBool),
    deleted: equals("deleted", "deleted", toBool),
    create_time: compare("create_time", "le", toDate),
    create_time_ge: compare("create_time", "ge", toDate),
    create_time_gt: compare("create_time", "gt", toDate),
    create_time_le: compare("create_time", "le", toDate),
    create_time_lt: compare("create_time", "lt", toDate),
    update_time: compare("update_time", "le", toDate),
    update_time_ge: compare("update_time", "ge", toDate),
    update_time_gt: compare("update_time", "gt", toDate),
    update_time_le: compare("update_time", "le", toDate),
    update_time_lt: compare("update_time", "lt", toDate),
};

/** Checks if filterSettings have default values. */
export function containsDefaults(filterSettings) {
    const normalized = getDefaults();
    let hasDefaults = true;
    for (const key in normalized) {
        const value = String(filterSettings[key]).toLowerCase();
        const normalizedValue = String(normalized[key]).toLowerCase();
        if (value !== normalizedValue) {
            hasDefaults = false;
            break;
        }
    }
    return hasDefaults;
}

/** Normalize defaults by adding the operator to the key identifier */
export function getDefaults() {
    const normalized = {};
    Object.entries(defaultFilters).forEach(([key, value]) => {
        normalized[`${key}:`] = value;
    });
    return normalized;
}

/** Build a text filter from filter settings */
export function getFilterText(filterSettings) {
    const normalized = getDefaults();
    const hasDefaults = containsDefaults(filterSettings);

    let newFilterText = "";
    Object.entries(filterSettings).forEach(([key, value]) => {
        const skipDefault = hasDefaults && normalized[key] !== undefined;
        if (!skipDefault && value !== undefined && value !== "") {
            if (newFilterText) {
                newFilterText += " ";
            }
            if (String(value).includes(" ")) {
                value = `'${value}'`;
            }
            newFilterText += `${key}${value}`;
        }
    });
    return newFilterText;
}

/** Parses single text input into a dict of field->value pairs. */
export function getFilters(filterText, useDefaultFilters = true) {
    const pairSplitRE = /[^\s']+(?:'[^']*'[^\s']*)*|(?:'[^']*'[^\s']*)+/g;
    const matches = filterText.match(pairSplitRE);
    let result = {};
    let hasMatches = false;
    if (matches) {
        matches.forEach((pair) => {
            const elgRE = /(\S+)([:><])(.+)/g;
            const elgMatch = elgRE.exec(pair);
            if (elgMatch) {
                let field = elgMatch[1];
                const elg = elgMatch[2];
                const value = elgMatch[3];
                // replace alias for less and greater symbol
                for (const [alias, substitute] of validAlias) {
                    if (elg === alias) {
                        field = `${field}${substitute}`;
                        break;
                    }
                }
                // replaces dashes with underscores in query field names
                const normalizedField = field.replaceAll("-", "_");
                if (validFilters[normalizedField]) {
                    // removes quotation and applies lower-case to filter value
                    result[normalizedField] = toLowerNoQuotes(value);
                    hasMatches = true;
                }
            }
        });
    }
    // assume name matching if no filter key has been matched
    if (!hasMatches && filterText.length > 0) {
        result["name"] = filterText;
    }
    // check if any default filter keys have been used
    let hasDefaults = false;
    for (const defaultKey in defaultFilters) {
        if (result[defaultKey]) {
            hasDefaults = true;
            break;
        }
    }
    // use default filters if none of the default filters has been explicitly specified
    if (!hasDefaults && useDefaultFilters) {
        result = { ...result, ...defaultFilters };
    }
    return Object.entries(result);
}

/** Returns a dictionary resembling filterSettings (for HistoryFilters):
 * e.g.: Unlike getFilters or getQueryDict, this maintains "hid>":"3" instead
 *       of changing it to "hid-gt":"3"
 * Only used to sync filterSettings (in HistoryFilters)
 * @param {Object} filters Parsed filterText from getFilters()
 */
export function toAlias(filters) {
    const result = {};
    for (const [key, value] of filters) {
        let hasAlias = false;
        for (const [alias, substitute] of validAlias) {
            if (key.endsWith(substitute)) {
                const keyPrefix = key.substr(0, key.length - substitute.length);
                result[`${keyPrefix}${alias}`] = value;
                hasAlias = true;
                break;
            }
        }
        if (!hasAlias) {
            result[`${key}:`] = value;
        }
    }
    return result;
}

/** Returns a dictionary with query key and values.
 * @param {String} filterText The raw filter text
 * @param {Boolean} [useDefaultFilters=true] The default filters are set if true
 */
export function getQueryDict(filterText, useDefaultFilters = true) {
    const queryDict = {};
    const filters = getFilters(filterText, useDefaultFilters);
    for (const [key, value] of filters) {
        const query = validFilters[key].query;
        const converter = validFilters[key].converter;
        queryDict[query] = converter ? converter(value) : value;
    }
    return queryDict;
}

/** Returns query string from filter text.
 * @param {String} filterText The raw filter text
 * @param {Boolean} useDefaultFilters The default filters are set if true
 * */
export function getQueryString(filterText, useDefaultFilters = true) {
    const filterDict = getQueryDict(filterText, useDefaultFilters);
    return Object.entries(filterDict)
        .map(([f, v]) => `q=${f}&qv=${v}`)
        .join("&");
}

/** Check the value of a particular filter. */
export function checkFilter(filterText, filterName, filterValue) {
    const re = new RegExp(`${filterName}:(\\S+)`);
    const reMatch = re.exec(filterText);
    const testValue = reMatch ? reMatch[1] : defaultFilters[filterName];
    return toLowerNoQuotes(testValue) === toLowerNoQuotes(filterValue);
}

/** Test if an item passes all filters. */
export function testFilters(filters, item) {
    for (const [key, filterValue] of filters) {
        const filterAttribute = validFilters[key].attribute;
        const filterHandler = validFilters[key].handler;
        const itemValue = item[filterAttribute];
        if (!filterHandler(itemValue, filterValue)) {
            return false;
        }
    }
    return true;
}
