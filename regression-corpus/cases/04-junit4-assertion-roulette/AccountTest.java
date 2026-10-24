import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class AccountTest {
    @Test
    public void exposesAccountDetails() {
        Account account = new Account();
        assertEquals(25, account.balance());
        assertTrue(account.active());
        assertEquals("Ada", account.owner());
    }
}
