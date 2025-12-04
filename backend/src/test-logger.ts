import { Logger } from './utils/Logger';
import dotenv from 'dotenv';

dotenv.config();

async function testLogger() {
    console.log('Testing Logger...');

    // Test Info Log
    await Logger.logInfo('TestCategory', 'This is a test info log', {
        TransactionID: 'tx-123',
        Endpoint: '/test',
    });
    console.log('Info log sent.');

    // Test Error Log
    try {
        throw new Error('Test error exception');
    } catch (err) {
        await Logger.logError('TestCategory', err, {
            TransactionID: 'tx-456',
            Endpoint: '/test-error',
        });
        console.log('Error log sent.');
    }
}

testLogger();
