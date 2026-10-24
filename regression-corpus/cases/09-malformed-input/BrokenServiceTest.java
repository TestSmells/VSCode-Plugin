import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class BrokenServiceTest {
    @Test
    public void readsValue() {
        BrokenService service = new BrokenService();
        assertEquals(1, service.value();
    }
}
