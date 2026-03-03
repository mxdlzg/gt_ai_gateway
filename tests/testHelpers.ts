/**
 * Test Helpers
 * Exposes database helpers for test files that need direct DB access
 */

import dbHelper from "./helpers/dbHelper";
import requestHelper from "./helpers/requestHelper";
import userFixtures from "./fixtures/userFixtures";

export default {
    query: dbHelper.query,
    execute: dbHelper.execute,
    truncateDatabase: dbHelper.truncate,
    /**
     * Setup test admin user
     * Creates an admin user via API (admin user already created in globalSetup)
     * Returns the admin token
     */
    async setupAdminUser() {
        const adminUser = userFixtures.USER_FIXTURES.admin;
        // Admin user is already created in globalSetup, just return the token
        return adminUser.token;
    },
};
